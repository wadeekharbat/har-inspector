import { describe, it, expect } from 'vitest';
import {
  filterRequests,
  sortRequests,
  paginateItems,
  computeWaterfallMetrics,
  computeWaterfallRenderModel,
  extractUniqueDomains,
  computeSessionSummary,
} from './explorer';
import { NormalizedRequest, NormalizedSession } from './types';

function createMockRequest(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  const sourceIndex = overrides.sourceIndex ?? 0;
  return {
    id: `req-${sourceIndex}`,
    sourceIndex,
    method: 'GET',
    origin: 'https://checkout.example.com',
    hostname: 'checkout.example.com',
    displayUrl: 'https://checkout.example.com/api/cart',
    startedDateTime: '2026-10-22T10:00:00.000Z',
    startOffsetMs: 0,
    durationMs: 150,
    status: 200,
    bodyBytes: 1024,
    mimeType: 'application/json',
    timings: null,
    warnings: [],
    urlGroupId: 'group-0',
    ...overrides,
  };
}

describe('', () => {
  describe('Deterministic Sorting and Unknown-Last Rules', () => {
    it('sorts numeric duration with unknowns last in both ASC and DESC', () => {
      const r0 = createMockRequest({ sourceIndex: 0, durationMs: 250 });
      const r1 = createMockRequest({ sourceIndex: 1, durationMs: null });
      const r2 = createMockRequest({ sourceIndex: 2, durationMs: 50 });
      const r3 = createMockRequest({ sourceIndex: 3, durationMs: null });
      const r4 = createMockRequest({ sourceIndex: 4, durationMs: 100 });

      const input = [r0, r1, r2, r3, r4];

      // Ascending sort
      const asc = sortRequests(input, { field: 'durationMs', direction: 'asc' });
      expect(asc.map((r) => r.id)).toEqual(['req-2', 'req-4', 'req-0', 'req-1', 'req-3']);
      // r1 and r3 have null duration and sort last in order of sourceIndex

      // Descending sort
      const desc = sortRequests(input, { field: 'durationMs', direction: 'desc' });
      expect(desc.map((r) => r.id)).toEqual(['req-0', 'req-4', 'req-2', 'req-1', 'req-3']);
      // Nulls MUST still sort last in descending order!
    });

    it('sorts bodyBytes with unknowns last in both ASC and DESC and breaks ties deterministically', () => {
      const r0 = createMockRequest({ sourceIndex: 0, bodyBytes: null });
      const r1 = createMockRequest({ sourceIndex: 1, bodyBytes: 0 }); // valid 0 size
      const r2 = createMockRequest({ sourceIndex: 2, bodyBytes: 5000 });
      const r3 = createMockRequest({ sourceIndex: 3, bodyBytes: 100 });
      const r4 = createMockRequest({ sourceIndex: 4, bodyBytes: null });

      const input = [r0, r1, r2, r3, r4];

      const asc = sortRequests(input, { field: 'bodyBytes', direction: 'asc' });
      expect(asc.map((r) => r.id)).toEqual(['req-1', 'req-3', 'req-2', 'req-0', 'req-4']);

      const desc = sortRequests(input, { field: 'bodyBytes', direction: 'desc' });
      expect(desc.map((r) => r.id)).toEqual(['req-2', 'req-3', 'req-1', 'req-0', 'req-4']);
    });

    it('sorts status with status 0 distinct from unknown (null) status', () => {
      const r0 = createMockRequest({ sourceIndex: 0, status: 200 });
      const r1 = createMockRequest({ sourceIndex: 1, status: 0 }); // 0 = no status recorded
      const r2 = createMockRequest({ sourceIndex: 2, status: null }); // unknown
      const r3 = createMockRequest({ sourceIndex: 3, status: 500 });
      const r4 = createMockRequest({ sourceIndex: 4, status: null });

      const input = [r0, r1, r2, r3, r4];

      // In ASC: 0 is finite number, sorts before 200 and 500. Nulls sort last.
      const asc = sortRequests(input, { field: 'status', direction: 'asc' });
      expect(asc.map((r) => r.id)).toEqual(['req-1', 'req-0', 'req-3', 'req-2', 'req-4']);

      // In DESC: 500 > 200 > 0. Nulls still sort last.
      const desc = sortRequests(input, { field: 'status', direction: 'desc' });
      expect(desc.map((r) => r.id)).toEqual(['req-3', 'req-0', 'req-1', 'req-2', 'req-4']);
    });

    it('sorts startOffsetMs deterministically with sourceIndex tie breaking', () => {
      const r0 = createMockRequest({ sourceIndex: 0, startOffsetMs: 500 });
      const r1 = createMockRequest({ sourceIndex: 1, startOffsetMs: 100 });
      const r2 = createMockRequest({ sourceIndex: 2, startOffsetMs: 100 }); // tie with r1

      const input = [r0, r1, r2];

      const asc = sortRequests(input, { field: 'startOffsetMs', direction: 'asc' });
      expect(asc.map((r) => r.id)).toEqual(['req-1', 'req-2', 'req-0']);

      const desc = sortRequests(input, { field: 'startOffsetMs', direction: 'desc' });
      expect(desc.map((r) => r.id)).toEqual(['req-0', 'req-1', 'req-2']);
    });

    it('never mutates the input requests array', () => {
      const r0 = createMockRequest({ sourceIndex: 0, startOffsetMs: 500 });
      const r1 = createMockRequest({ sourceIndex: 1, startOffsetMs: 100 });
      const original = [r0, r1];
      const copy = [...original];

      sortRequests(original, { field: 'startOffsetMs', direction: 'asc' });
      expect(original).toEqual(copy);
    });
  });

  describe('Filtering: Search, Domain, and Status Groups', () => {
    const requests: NormalizedRequest[] = [
      createMockRequest({
        sourceIndex: 0,
        method: 'GET',
        hostname: 'api.example.com',
        origin: 'https://api.example.com',
        displayUrl: 'https://api.example.com/v1/user?query_omitted',
        status: 200,
      }),
      createMockRequest({
        sourceIndex: 1,
        method: 'POST',
        hostname: 'checkout.example.com',
        origin: 'https://checkout.example.com',
        displayUrl: 'https://checkout.example.com/pay',
        status: 500,
      }),
      createMockRequest({
        sourceIndex: 2,
        method: 'GET',
        hostname: 'static.example.com',
        origin: 'https://static.example.com',
        displayUrl: 'https://static.example.com/bundle.js',
        status: 304,
      }),
      createMockRequest({
        sourceIndex: 3,
        method: 'GET',
        hostname: 'checkout.example.com',
        origin: 'https://checkout.example.com',
        displayUrl: 'https://checkout.example.com/order-status',
        status: 0, // no status
      }),
      createMockRequest({
        sourceIndex: 4,
        method: 'GET',
        hostname: 'checkout.example.com',
        origin: 'https://checkout.example.com',
        displayUrl: 'https://checkout.example.com/bad',
        status: null, // unknown status
      }),
      createMockRequest({
        sourceIndex: 5,
        method: 'DELETE',
        hostname: 'api.example.com',
        origin: 'https://api.example.com',
        displayUrl: 'https://api.example.com/v1/session',
        status: 404,
      }),
    ];

    it('filters by status group accurately', () => {
      expect(filterRequests(requests, { searchQuery: '', selectedDomain: 'all', statusGroup: '2xx' }).map(r => r.id)).toEqual(['req-0']);
      expect(filterRequests(requests, { searchQuery: '', selectedDomain: 'all', statusGroup: '3xx' }).map(r => r.id)).toEqual(['req-2']);
      expect(filterRequests(requests, { searchQuery: '', selectedDomain: 'all', statusGroup: '4xx' }).map(r => r.id)).toEqual(['req-5']);
      expect(filterRequests(requests, { searchQuery: '', selectedDomain: 'all', statusGroup: '5xx' }).map(r => r.id)).toEqual(['req-1']);
      expect(filterRequests(requests, { searchQuery: '', selectedDomain: 'all', statusGroup: 'no-status' }).map(r => r.id)).toEqual(['req-3']);
      expect(filterRequests(requests, { searchQuery: '', selectedDomain: 'all', statusGroup: 'unknown' }).map(r => r.id)).toEqual(['req-4']);
      expect(filterRequests(requests, { searchQuery: '', selectedDomain: 'all', statusGroup: 'all' }).length).toBe(6);
    });

    it('filters by domain', () => {
      const result = filterRequests(requests, {
        searchQuery: '',
        selectedDomain: 'checkout.example.com',
        statusGroup: 'all',
      });
      expect(result.map(r => r.id)).toEqual(['req-1', 'req-3', 'req-4']);
    });

    it('filters by case-insensitive search query matching method or url or host', () => {
      // By method
      expect(filterRequests(requests, { searchQuery: 'post', selectedDomain: 'all', statusGroup: 'all' }).map(r => r.id)).toEqual(['req-1']);
      // By URL substring
      expect(filterRequests(requests, { searchQuery: 'user', selectedDomain: 'all', statusGroup: 'all' }).map(r => r.id)).toEqual(['req-0']);
      // By host
      expect(filterRequests(requests, { searchQuery: 'static', selectedDomain: 'all', statusGroup: 'all' }).map(r => r.id)).toEqual(['req-2']);
    });

    it('combines search, domain, and status group filters predictably', () => {
      const combined = filterRequests(requests, {
        searchQuery: 'checkout',
        selectedDomain: 'checkout.example.com',
        statusGroup: '5xx',
      });
      expect(combined.map(r => r.id)).toEqual(['req-1']);
    });

    it('clearing filters returns all requests', () => {
      const filtered = filterRequests(requests, {
        searchQuery: 'something-not-found',
        selectedDomain: 'all',
        statusGroup: 'all',
      });
      expect(filtered.length).toBe(0);

      const cleared = filterRequests(requests, {
        searchQuery: '',
        selectedDomain: 'all',
        statusGroup: 'all',
      });
      expect(cleared.length).toBe(requests.length);
    });

    it('extracts unique sorted domains from requests', () => {
      const domains = extractUniqueDomains(requests);
      expect(domains).toEqual(['api.example.com', 'checkout.example.com', 'static.example.com']);
    });
  });

  describe('Pagination: Resets, Clamping, and Page Slices', () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ id: `item-${i}` }));

    it('paginates 100 items per page by default', () => {
      const page1 = paginateItems(items, 1);
      expect(page1.items.length).toBe(100);
      expect(page1.currentPage).toBe(1);
      expect(page1.totalPages).toBe(3);
      expect(page1.startIndex).toBe(0);
      expect(page1.endIndex).toBe(100);

      const page3 = paginateItems(items, 3);
      expect(page3.items.length).toBe(50);
      expect(page3.currentPage).toBe(3);
      expect(page3.startIndex).toBe(200);
      expect(page3.endIndex).toBe(250);
    });

    it('clamps page number when out of bounds or when results shrink', () => {
      // Clamps requested page 99 down to 3
      const clampedHigh = paginateItems(items, 99);
      expect(clampedHigh.currentPage).toBe(3);

      // Clamps page 0 or negative up to 1
      const clampedLow = paginateItems(items, 0);
      expect(clampedLow.currentPage).toBe(1);

      // When items array is smaller (e.g. after filter change to 25 items), page 3 clamps to 1
      const smallItems = items.slice(0, 25);
      const clampedShrunk = paginateItems(smallItems, 3);
      expect(clampedShrunk.currentPage).toBe(1);
      expect(clampedShrunk.totalPages).toBe(1);
      expect(clampedShrunk.items.length).toBe(25);
    });

    it('handles empty items array gracefully', () => {
      const emptyResult = paginateItems([], 1);
      expect(emptyResult.items).toEqual([]);
      expect(emptyResult.currentPage).toBe(1);
      expect(emptyResult.totalPages).toBe(1);
      expect(emptyResult.totalItems).toBe(0);
    });
  });

  describe('Waterfall Metrics and Session-Wide Timeline Scale', () => {
    it('computes leftPercent and widthPercent relative to totalSpanMs', () => {
      const req = createMockRequest({
        startOffsetMs: 500,
        durationMs: 1000,
      });
      const metrics = computeWaterfallMetrics(req, 2000);

      expect(metrics.leftPercent).toBe(25); // 500 / 2000 = 25%
      expect(metrics.widthPercent).toBe(50); // 1000 / 2000 = 50%
      expect(metrics.isUnknownDuration).toBe(false);
      expect(metrics.displayLabel).toBe('1,000 ms');
    });

    it('handles zero span using minimum visual scale without changing true values', () => {
      const req = createMockRequest({
        startOffsetMs: 0,
        durationMs: 0,
      });
      // Session total span is 0 ms
      const metrics = computeWaterfallMetrics(req, 0, 100);

      expect(metrics.leftPercent).toBe(0);
      expect(metrics.widthPercent).toBe(0);
      expect(metrics.isUnknownDuration).toBe(false);
      expect(metrics.displayLabel).toBe('0 ms');
    });

    it('handles unknown duration with a marker and zero widthPercent', () => {
      const req = createMockRequest({
        startOffsetMs: 600,
        durationMs: null,
      });
      const metrics = computeWaterfallMetrics(req, 1200);

      expect(metrics.leftPercent).toBe(50); // 600 / 1200 = 50%
      expect(metrics.widthPercent).toBe(0);
      expect(metrics.isUnknownDuration).toBe(true);
      expect(metrics.displayLabel).toBe('Unknown duration');
    });

    it('defensively clips percentages to fit within [0, 100]', () => {
      const req = createMockRequest({
        startOffsetMs: 900,
        durationMs: 500, // extends past 1000ms span
      });
      const metrics = computeWaterfallMetrics(req, 1000);

      expect(metrics.leftPercent).toBe(90);
      expect(metrics.widthPercent).toBe(10); // clipped so 90 + 10 = 100
      expect(metrics.leftPercent + metrics.widthPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('Session Summary and Distinct Counts', () => {
    it('keeps status 0 distinct from unknown status and computes known-byte totals with unknown-size counts', () => {
      const reqs: NormalizedRequest[] = [
        createMockRequest({ sourceIndex: 0, status: 200, bodyBytes: 2000 }),
        createMockRequest({ sourceIndex: 1, status: 0, bodyBytes: 500 }), // status 0
        createMockRequest({ sourceIndex: 2, status: null, bodyBytes: null }), // unknown status & unknown size
        createMockRequest({ sourceIndex: 3, status: 502, bodyBytes: 1500 }), // http error
        createMockRequest({ sourceIndex: 4, status: 404, bodyBytes: null }), // http error & unknown size
      ];

      const session: NormalizedSession = {
        requests: reqs,
        timeline: {
          originTimestampMs: 1700000000000,
          totalSpanMs: 3500,
        },
        stats: {
          totalRawEntries: 6,
          acceptedEntries: 5,
          skippedEntries: 1,
          knownBodyBytesTotal: 4000,
          unknownBodyBytesCount: 2,
          httpErrorCount: 2,
          unknownStatusCount: 1,
        },
        warnings: [],
      };

      const summary = computeSessionSummary(session);

      expect(summary.totalRequests).toBe(5);
      expect(summary.httpErrorCount).toBe(2); // 502 and 404
      expect(summary.noStatusCount).toBe(1); // status 0
      expect(summary.unknownStatusCount).toBe(1); // status null
      expect(summary.knownBodyBytesTotal).toBe(4000); // 2000 + 500 + 1500
      expect(summary.unknownBodyBytesCount).toBe(2); // req-2 and req-4
    });
  });

  describe('Unsorted Records, Relative Offsets, and End Extent', () => {
    it('verifies relative offsets and end extents from unsorted records with unknown and zero durations', () => {
      // Suppose records arrive out of order:
      // Entry A: started at T+2000, duration 500 => offset 2000, extent 2500
      // Entry B: started at T+0 (earliest origin), duration null (unknown) => offset 0, extent 0 (contributes start only)
      // Entry C: started at T+1000, duration 0 (zero duration) => offset 1000, extent 1000
      // Entry D: started at T+500, duration 3000 => offset 500, extent 3500 (max extent)
      const reqA = createMockRequest({ sourceIndex: 0, startOffsetMs: 2000, durationMs: 500 });
      const reqB = createMockRequest({ sourceIndex: 1, startOffsetMs: 0, durationMs: null });
      const reqC = createMockRequest({ sourceIndex: 2, startOffsetMs: 1000, durationMs: 0 });
      const reqD = createMockRequest({ sourceIndex: 3, startOffsetMs: 500, durationMs: 3000 });

      const totalSpanMs = Math.max(
        reqA.startOffsetMs + (reqA.durationMs ?? 0),
        reqB.startOffsetMs + (reqB.durationMs ?? 0),
        reqC.startOffsetMs + (reqC.durationMs ?? 0),
        reqD.startOffsetMs + (reqD.durationMs ?? 0)
      );

      expect(totalSpanMs).toBe(3500); // 500 + 3000

      // Waterfall metrics for each:
      const metricsA = computeWaterfallMetrics(reqA, totalSpanMs);
      expect(metricsA.leftPercent).toBeCloseTo((2000 / 3500) * 100, 2);
      expect(metricsA.widthPercent).toBeCloseTo((500 / 3500) * 100, 2);
      expect(metricsA.isUnknownDuration).toBe(false);

      const metricsB = computeWaterfallMetrics(reqB, totalSpanMs);
      expect(metricsB.leftPercent).toBe(0);
      expect(metricsB.widthPercent).toBe(0);
      expect(metricsB.isUnknownDuration).toBe(true);

      const metricsC = computeWaterfallMetrics(reqC, totalSpanMs);
      expect(metricsC.leftPercent).toBeCloseTo((1000 / 3500) * 100, 2);
      expect(metricsC.widthPercent).toBe(0);
      expect(metricsC.isUnknownDuration).toBe(false);
      expect(metricsC.displayLabel).toBe('0 ms');

      const metricsD = computeWaterfallMetrics(reqD, totalSpanMs);
      expect(metricsD.leftPercent).toBeCloseTo((500 / 3500) * 100, 2);
      expect(metricsD.widthPercent).toBeCloseTo((3000 / 3500) * 100, 2);
    });
  });

  describe('Waterfall Render Model and Geometry Regressions (Finding 1)', () => {
    it('strictly preserves computed duration width for short bars without artificial expansion', () => {
      // 1 ms request in a 10,000 ms session: widthPercent is exactly 0.01%
      const shortReq = createMockRequest({
        startOffsetMs: 1000,
        durationMs: 1,
      });
      const model = computeWaterfallRenderModel(shortReq, 10000);

      expect(model.renderKind).toBe('bar');
      expect(model.isZeroDuration).toBe(false);
      expect(model.isUnknownDuration).toBe(false);
      expect(model.leftPercent).toBe(10); // 1000 / 10000 = 10%
      expect(model.widthPercent).toBe(0.01); // 1 / 10000 = 0.01% (NEVER forced to 0.5%)
      expect(model.widthPercent).toBeLessThan(0.5);
      expect(model.displayLabel).toBe('1 ms');
    });

    it('renders zero duration as a zero-point marker with zero width and no positive bar geometry', () => {
      const zeroReq = createMockRequest({
        startOffsetMs: 500,
        durationMs: 0,
      });
      const model = computeWaterfallRenderModel(zeroReq, 2000);

      expect(model.renderKind).toBe('zero-point');
      expect(model.isZeroDuration).toBe(true);
      expect(model.isUnknownDuration).toBe(false);
      expect(model.leftPercent).toBe(25); // 500 / 2000 = 25%
      expect(model.widthPercent).toBe(0); // STRICTLY 0%, never positive bar
      expect(model.displayLabel).toBe('0 ms');
      expect(model.accessibleTitle).toContain('Zero duration: 0 ms');
    });

    it('handles requests starting at the session endpoint without overflow', () => {
      // Session total span is 4000 ms; request starts at 4000 ms with duration 0
      const endpointReq = createMockRequest({
        startOffsetMs: 4000,
        durationMs: 0,
      });
      const model = computeWaterfallRenderModel(endpointReq, 4000);

      expect(model.leftPercent).toBe(100);
      expect(model.widthPercent).toBe(0);
      expect(model.renderKind).toBe('zero-point');
      expect(model.alignmentClass).toBe('marker-at-end'); // anchors marker inside track boundary
    });

    it('handles zero-span sessions for both zero-duration and unknown-duration requests', () => {
      // Session total span is 0 ms
      const zeroReq = createMockRequest({ startOffsetMs: 0, durationMs: 0 });
      const unknownReq = createMockRequest({ startOffsetMs: 0, durationMs: null });

      const zeroModel = computeWaterfallRenderModel(zeroReq, 0, 100);
      expect(zeroModel.renderKind).toBe('zero-point');
      expect(zeroModel.leftPercent).toBe(0);
      expect(zeroModel.widthPercent).toBe(0);
      expect(zeroModel.displayLabel).toBe('0 ms');

      const unknownModel = computeWaterfallRenderModel(unknownReq, 0, 100);
      expect(unknownModel.renderKind).toBe('unknown-marker');
      expect(unknownModel.leftPercent).toBe(0);
      expect(unknownModel.widthPercent).toBe(0);
      expect(unknownModel.displayLabel).toBe('Unknown duration');
    });
  });
});



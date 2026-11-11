import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import syntheticCheckout from './synthetic-checkout.har.json';
import { RULE_THRESHOLDS, type NormalizedRequest, type DiagnosticFinding } from '../domain/types';
import { DemoGuide } from '../components/DemoGuide';
import { ExportHelpModal } from '../components/ExportHelpModal';

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    content: {
      size: number;
      mimeType: string;
    };
    bodySize: number;
  };
  timings: {
    blocked: number;
    dns: number;
    connect: number;
    send: number;
    wait: number;
    receive: number;
    ssl?: number;
  };
}

describe('Synthetic Checkout Fixture & Contract Sanity', () => {
  it('conforms to top-level HAR 1.2 structure', () => {
    expect(syntheticCheckout).toBeDefined();
    expect(syntheticCheckout.log).toBeDefined();
    expect(syntheticCheckout.log.version).toBe('1.2');
    expect(syntheticCheckout.log.creator.name).toBe('HAR Inspector Synthetic Generator');
    expect(Array.isArray(syntheticCheckout.log.entries)).toBe(true);
    expect(syntheticCheckout.log.entries.length).toBe(10);
  });

  it('validates all entries conform to HAR data contract', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];

    for (const [index, entry] of entries.entries()) {
      // Parseable start timestamp
      const parsedTime = Date.parse(entry.startedDateTime);
      expect(Number.isNaN(parsedTime), `Entry ${index} invalid startedDateTime`).toBe(false);

      // Duration finite and nonnegative
      expect(Number.isFinite(entry.time), `Entry ${index} duration must be finite`).toBe(true);
      expect(entry.time, `Entry ${index} duration must be nonnegative`).toBeGreaterThanOrEqual(0);

      // Request method and parseable absolute URL
      expect(entry.request.method).toMatch(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/);
      expect(() => new URL(entry.request.url)).not.toThrow();
      const parsedUrl = new URL(entry.request.url);
      expect(['http:', 'https:']).toContain(parsedUrl.protocol);
      expect(parsedUrl.hostname.endsWith('example.com')).toBe(true);

      // Status finite integer 0-599
      expect(Number.isInteger(entry.response.status)).toBe(true);
      expect(entry.response.status).toBeGreaterThanOrEqual(0);
      expect(entry.response.status).toBeLessThanOrEqual(599);

      // Body size finite and nonnegative
      expect(Number.isFinite(entry.response.bodySize)).toBe(true);
      expect(entry.response.bodySize).toBeGreaterThanOrEqual(0);

      // Timings phases
      const { blocked, dns, connect, send, wait, receive } = entry.timings;
      for (const phase of [blocked, dns, connect, send, wait, receive]) {
        expect(phase === -1 || (Number.isFinite(phase) && phase >= 0)).toBe(true);
      }
    }
  });

  it('verifies exact documented total body bytes equals 1,330,683 bytes', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const totalRecordedBytes = entries.reduce((sum, entry) => sum + entry.response.bodySize, 0);

    expect(totalRecordedBytes).toBe(1330683);
  });

  it('verifies exact documented timeline span equals 4,002 ms', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const origin = Math.min(...entries.map((e) => Date.parse(e.startedDateTime)));
    expect(origin).toBe(Date.parse('2026-10-22T10:00:00.000Z'));

    const extents = entries.map((entry) => {
      const startOffsetMs = Date.parse(entry.startedDateTime) - origin;
      const durationMs = Number.isFinite(entry.time) && entry.time >= 0 ? entry.time : 0;
      return startOffsetMs + durationMs;
    });

    const totalSpanMs = Math.max(...extents);
    expect(totalSpanMs).toBe(4002);
  });

  it('contains expected known HTTP error request (status 400-599)', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const errorEntries = entries.filter(
      (e) => e.response.status >= RULE_THRESHOLDS.HTTP_ERROR_MIN_STATUS &&
             e.response.status <= RULE_THRESHOLDS.HTTP_ERROR_MAX_STATUS
    );

    expect(errorEntries.length).toBe(1);
    expect(errorEntries[0].request.url).toBe('https://api.example.com/v1/checkout/pay');
    expect(errorEntries[0].response.status).toBe(500);
  });

  it('contains expected long request (duration >= 1000 ms)', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const slowEntries = entries.filter((e) => e.time >= RULE_THRESHOLDS.LONG_REQUEST_MS);

    expect(slowEntries.length).toBe(1);
    expect(slowEntries[0].request.url).toBe('https://api.example.com/v1/shipping/rates');
    expect(slowEntries[0].time).toBe(1420);
    expect(slowEntries[0].time).toBeGreaterThanOrEqual(RULE_THRESHOLDS.LONG_REQUEST_MS);
  });

  it('contains expected large recorded body (bodySize >= 1,048,576 bytes)', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const largeEntries = entries.filter((e) => e.response.bodySize >= RULE_THRESHOLDS.LARGE_BODY_BYTES);

    expect(largeEntries.length).toBe(1);
    expect(largeEntries[0].request.url).toBe('https://cdn.example.com/images/checkout-hero-banner.png');
    expect(largeEntries[0].response.bodySize).toBe(1258291);
    expect(largeEntries[0].response.bodySize).toBeGreaterThanOrEqual(RULE_THRESHOLDS.LARGE_BODY_BYTES);
  });

  it('contains expected repeated GET group (>= 3 GETs within 2000 ms window)', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const pollingEntries = entries.filter(
      (e) => e.request.method === 'GET' && e.request.url.includes('/orders/status')
    );

    expect(pollingEntries.length).toBe(3);

    const timestamps = pollingEntries.map((e) => Date.parse(e.startedDateTime));
    const windowSpan = Math.max(...timestamps) - Math.min(...timestamps);

    expect(windowSpan).toBe(950);
    expect(windowSpan).toBeLessThanOrEqual(RULE_THRESHOLDS.REPEATED_GET_WINDOW_MS);
  });

  it('contains normal baseline requests', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const normalEntries = entries.filter(
      (e) =>
        e.response.status === 200 &&
        e.time < RULE_THRESHOLDS.LONG_REQUEST_MS &&
        e.response.bodySize < RULE_THRESHOLDS.LARGE_BODY_BYTES &&
        !e.request.url.includes('/orders/status')
    );

    expect(normalEntries.length).toBeGreaterThanOrEqual(3);
  });

  it('has consistent and sensible timestamps', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];
    const timestamps = entries.map((e) => Date.parse(e.startedDateTime));

    const origin = Math.min(...timestamps);
    expect(origin).toBe(Date.parse('2026-10-22T10:00:00.000Z'));

    for (const ts of timestamps) {
      expect(ts).toBeGreaterThanOrEqual(origin);
      expect(ts - origin).toBeLessThan(5000);
    }
  });

  it('verifies RULE_THRESHOLDS matches specification', () => {
    expect(RULE_THRESHOLDS.LONG_REQUEST_MS).toBe(1000);
    expect(RULE_THRESHOLDS.LARGE_BODY_BYTES).toBe(1048576);
    expect(RULE_THRESHOLDS.REPEATED_GET_MIN_COUNT).toBe(3);
    expect(RULE_THRESHOLDS.REPEATED_GET_WINDOW_MS).toBe(2000);
    expect(RULE_THRESHOLDS.HTTP_ERROR_MIN_STATUS).toBe(400);
    expect(RULE_THRESHOLDS.HTTP_ERROR_MAX_STATUS).toBe(599);
    expect(RULE_THRESHOLDS.MAX_FILE_BYTES).toBe(10485760);
    expect(RULE_THRESHOLDS.MAX_RAW_ENTRIES).toBe(2000);
    expect(RULE_THRESHOLDS.PAGE_SIZE).toBe(100);
  });

  it('verifies NormalizedRequest and DiagnosticFinding type contracts are satisfied', () => {
    // Type-level and minimal runtime check for new contract fields:
    // NormalizedRequest.warnings and DiagnosticFinding.threshold
    const sampleFinding: DiagnosticFinding = {
      id: 'finding-1',
      ruleId: 'long-request',
      label: 'Long Request (> 1,000 ms)',
      observationLevel: 'warning',
      requestIds: ['req-5'],
      observedValues: { durationMs: 1420 },
      threshold: RULE_THRESHOLDS.LONG_REQUEST_MS,
      explanation: 'Shipping quote duration exceeded 1,000 ms.',
      nextInvestigation: 'Inspect network phases or server calculation latency.',
      limitations: 'Duration is a heuristic.',
    };
    expect(sampleFinding.threshold).toBe(1000);

    const sampleRequest: NormalizedRequest = {
      id: 'req-0',
      sourceIndex: 0,
      method: 'GET',
      origin: 'https://checkout.example.com',
      hostname: 'checkout.example.com',
      displayUrl: 'https://checkout.example.com/checkout',
      startedDateTime: '2026-10-22T10:00:00.000Z',
      startOffsetMs: 0,
      durationMs: 85,
      status: 200,
      bodyBytes: 12450,
      mimeType: 'text/html',
      timings: null,
      warnings: [],
      urlGroupId: 'group-0',
    };
    expect(Array.isArray(sampleRequest.warnings)).toBe(true);
  });
});

describe('Clean E-Commerce Catalog Fixture ()', () => {
  // Dynamically import clean session fixture
  it('conforms to HAR 1.2 structure and contains 6 healthy requests', async () => {
    const cleanSession = (await import('./clean-session.har.json')).default;
    expect(cleanSession).toBeDefined();
    expect(cleanSession.log.version).toBe('1.2');
    expect(cleanSession.log.entries).toHaveLength(6);

    for (const entry of cleanSession.log.entries) {
      expect(entry.response.status).toBe(200);
      expect(entry.time).toBeLessThan(200); // Well under 1,000 ms threshold
      expect(entry.response.bodySize).toBeLessThan(50000); // Well under 1 MiB threshold
    }
  });

  it('evaluates to exactly zero diagnostic findings through real parser and heuristics', async () => {
    const cleanSession = (await import('./clean-session.har.json')).default;
    const { parseHarData } = await import('../domain/parser');
    const { evaluateDiagnostics } = await import('../domain/diagnostics');

    const result = parseHarData(cleanSession);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.session.requests).toHaveLength(6);
    expect(result.session.warnings).toHaveLength(0);

    const findings = evaluateDiagnostics(result.session.requests);
    expect(findings).toHaveLength(0);
  });

  it('verifies DemoGuide steps faithfully reflect synthetic checkout fixture properties', () => {
    const entries = syntheticCheckout.log.entries as HarEntry[];

    // Step 1: Payment API Failure (req-6, index 6)
    const step1Entry = entries[6];
    expect(step1Entry.request.method).toBe('POST');
    expect(step1Entry.request.url).toBe('https://api.example.com/v1/checkout/pay');
    expect(step1Entry.response.status).toBe(500);
    expect(step1Entry.timings.wait).toBe(202);

    // Step 2: Order Status Polling Loop (req-7..9, indices 7, 8, 9)
    const pollingEntries = [entries[7], entries[8], entries[9]];
    const pollingUrl = 'https://api.example.com/v1/orders/status?order_id=ord_99812';
    for (const e of pollingEntries) {
      expect(e.request.method).toBe('GET');
      expect(e.request.url).toBe(pollingUrl);
    }
    const t7 = Date.parse(entries[7].startedDateTime);
    const t9 = Date.parse(entries[9].startedDateTime);
    expect(t9 - t7).toBe(950); // Exact 950 ms window

    // Step 3: Shipping Rates Latency (req-5, index 5)
    const step3Entry = entries[5];
    expect(step3Entry.request.method).toBe('POST');
    expect(step3Entry.request.url).toBe('https://api.example.com/v1/shipping/rates');
    expect(step3Entry.time).toBe(1420);
    expect(step3Entry.timings.wait).toBe(1410); // Exact HAR wait phase
    expect(step3Entry.timings.blocked + step3Entry.timings.send + step3Entry.timings.wait + step3Entry.timings.receive).toBe(1420);
    expect(step3Entry.time).toBeGreaterThanOrEqual(RULE_THRESHOLDS.LONG_REQUEST_MS);

    // Step 4: Hero Banner Large Body (req-3, index 3)
    const step4Entry = entries[3];
    expect(step4Entry.request.method).toBe('GET');
    expect(step4Entry.request.url).toBe('https://cdn.example.com/images/checkout-hero-banner.png');
    expect(step4Entry.response.bodySize).toBe(1258291);
    expect(step4Entry.response.bodySize).toBeGreaterThanOrEqual(RULE_THRESHOLDS.LARGE_BODY_BYTES);
  });

  it('verifies rendered DemoGuide text contains exact fixture values and no false wait claims', () => {
    const html = renderToString(React.createElement(DemoGuide, { onNavigateToRequest: () => {} }));

    // Must contain 1,410 ms HAR wait phase
    expect(html).toContain('1,410 ms recorded HAR wait phase');
    // Must NOT contain erroneous 1,390 ms claim
    expect(html).not.toContain('1,390 ms');
    expect(html).toContain('The HAR recorded a 202 ms wait for the response.');
    // Must NOT contain categorical 'Server Failure'
    expect(html).not.toContain('Server Failure');
    expect(html).toContain('HTTP 500 Error');
    // Must contain exact body size
    expect(html).toContain('1,258,291 bytes (1.20 MB)');
  });

  it('verifies rendered ExportHelpModal text uses official Chrome export options and no obsolete phrases', () => {
    const html = renderToString(React.createElement(ExportHelpModal, { isOpen: true, onClose: () => {} }));

    // Must contain official Chrome sanitized options
    expect(html).toContain('Export HAR (sanitized)');
    expect(html).toContain('Save all [listed] as HAR (sanitized)');
    expect(html).toContain('https://developer.chrome.com/docs/devtools/network/reference/#save-as-har');
    // Must NOT contain obsolete 'with content' phrasing
    expect(html).not.toContain('with content');
    // Must contain explicit caveat on host and path sensitivity
    expect(html).toContain('URL hostnames and paths');
    expect(html).toContain('complete anonymization is not claimed');
  });
});


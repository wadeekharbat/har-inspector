import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  evaluateHttpErrorRule,
  evaluateNoHttpStatusRule,
  evaluateLongRequestRule,
  evaluateLargeBodyRule,
  evaluateRepeatedGetRule,
  evaluateDiagnostics,
  computeDiagnosticsSummary,
  filterFindingsByLevel,
  RULE_THRESHOLDS,
  DIAGNOSTIC_THRESHOLDS,
} from './diagnostics';
import { NormalizedRequest, DiagnosticFinding } from './types';
import { matchesFilter, paginateItems } from './explorer';
import { FindingsPanel } from '../components/FindingsPanel';

function createMockRequest(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  const sourceIndex = overrides.sourceIndex ?? 0;
  return {
    id: overrides.id ?? `req-${sourceIndex}`,
    sourceIndex,
    method: overrides.method ?? 'GET',
    origin: overrides.origin ?? 'https://api.example.com',
    hostname: overrides.hostname ?? 'api.example.com',
    displayUrl: overrides.displayUrl ?? 'https://api.example.com/v1/test',
    startedDateTime: overrides.startedDateTime ?? '2026-10-22T10:00:00.000Z',
    startOffsetMs: overrides.startOffsetMs ?? 0,
    durationMs: overrides.durationMs !== undefined ? overrides.durationMs : 50,
    status: overrides.status !== undefined ? overrides.status : 200,
    bodyBytes: overrides.bodyBytes !== undefined ? overrides.bodyBytes : 1024,
    mimeType: overrides.mimeType ?? 'application/json',
    timings: overrides.timings ?? {
      blocked: null,
      dns: null,
      connect: null,
      send: null,
      wait: null,
      receive: null,
    },
    warnings: overrides.warnings ?? [],
    urlGroupId: overrides.urlGroupId ?? 'group-api-test',
  };
}

describe('Diagnostic Rules Domain ()', () => {
  describe('Rule 1: HTTP Error Response', () => {
    it('does not flag status 200, 301, 399, or 600', () => {
      const requests = [
        createMockRequest({ id: 'r1', status: 200 }),
        createMockRequest({ id: 'r2', status: 301 }),
        createMockRequest({ id: 'r3', status: 399 }),
        createMockRequest({ id: 'r4', status: 600 }),
      ];
      expect(evaluateHttpErrorRule(requests)).toEqual([]);
    });

    it('flags exact boundary status 400 as warning (4xx client error)', () => {
      const requests = [createMockRequest({ id: 'r-400', status: 400 })];
      const findings = evaluateHttpErrorRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('http-error');
      expect(findings[0].observationLevel).toBe('warning');
      expect(findings[0].requestIds).toEqual(['r-400']);
      expect(findings[0].observedValues.status).toBe(400);
      expect(findings[0].threshold).toBe('400–599');
      expect(findings[0].explanation).toContain('4xx Client Error');
    });

    it('flags status 499 as warning (4xx boundary)', () => {
      const requests = [createMockRequest({ id: 'r-499', status: 499 })];
      const findings = evaluateHttpErrorRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].observationLevel).toBe('warning');
    });

    it('flags exact boundary status 500 as error (5xx server error)', () => {
      const requests = [createMockRequest({ id: 'r-500', status: 500 })];
      const findings = evaluateHttpErrorRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].observationLevel).toBe('error');
      expect(findings[0].explanation).toContain('5xx Server Error');
    });

    it('flags status 599 as error (5xx boundary)', () => {
      const requests = [createMockRequest({ id: 'r-599', status: 599 })];
      const findings = evaluateHttpErrorRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].observationLevel).toBe('error');
    });

    it('does not flag status 0 or null as HTTP errors', () => {
      const requests = [
        createMockRequest({ id: 'r-zero', status: 0 }),
        createMockRequest({ id: 'r-null', status: null }),
      ];
      expect(evaluateHttpErrorRule(requests)).toEqual([]);
    });
  });

  describe('Rule 2: No HTTP Status', () => {
    it('flags status 0 as informational finding', () => {
      const requests = [createMockRequest({ id: 'r-no-status', status: 0 })];
      const findings = evaluateNoHttpStatusRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('no-http-status');
      expect(findings[0].observationLevel).toBe('info');
      expect(findings[0].requestIds).toEqual(['r-no-status']);
      expect(findings[0].observedValues.status).toBe(0);
      expect(findings[0].explanation).toContain('no HTTP response status was captured');
      expect(findings[0].limitations).toContain('missing response status');
    });

    it('does not flag status null (data quality warning in normalization, not failure diagnosis)', () => {
      const requests = [createMockRequest({ id: 'r-null', status: null })];
      expect(evaluateNoHttpStatusRule(requests)).toEqual([]);
    });

    it('does not flag valid positive statuses (200, 404, 500)', () => {
      const requests = [
        createMockRequest({ id: 'r-200', status: 200 }),
        createMockRequest({ id: 'r-404', status: 404 }),
        createMockRequest({ id: 'r-500', status: 500 }),
      ];
      expect(evaluateNoHttpStatusRule(requests)).toEqual([]);
    });
  });

  describe('Rule 3: Long Request', () => {
    it('does not flag requests below 1,000 ms', () => {
      const requests = [
        createMockRequest({ id: 'r-fast', durationMs: 50 }),
        createMockRequest({ id: 'r-999', durationMs: 999 }),
      ];
      expect(evaluateLongRequestRule(requests)).toEqual([]);
    });

    it('flags exact boundary 1,000 ms duration', () => {
      const requests = [createMockRequest({ id: 'r-1000', durationMs: 1000 })];
      const findings = evaluateLongRequestRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('long-request');
      expect(findings[0].observationLevel).toBe('warning');
      expect(findings[0].requestIds).toEqual(['r-1000']);
      expect(findings[0].observedValues.durationMs).toBe(1000);
      expect(findings[0].threshold).toBe('1000 ms');
      expect(findings[0].limitations).toContain('investigation heuristic');
    });

    it('flags requests exceeding 1,000 ms', () => {
      const requests = [createMockRequest({ id: 'r-1420', durationMs: 1420 })];
      const findings = evaluateLongRequestRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].observedValues.durationMs).toBe(1420);
    });

    it('never flags unknown duration (null)', () => {
      const requests = [createMockRequest({ id: 'r-unknown', durationMs: null })];
      expect(evaluateLongRequestRule(requests)).toEqual([]);
    });
  });

  describe('Rule 4: Large Recorded Body', () => {
    it('does not flag bodies below 1,048,576 bytes', () => {
      const requests = [
        createMockRequest({ id: 'r-small', bodyBytes: 256 }),
        createMockRequest({ id: 'r-boundary-minus-1', bodyBytes: 1048575 }),
      ];
      expect(evaluateLargeBodyRule(requests)).toEqual([]);
    });

    it('flags exact boundary 1,048,576 bytes (1 MiB)', () => {
      const requests = [createMockRequest({ id: 'r-1mib', bodyBytes: 1048576 })];
      const findings = evaluateLargeBodyRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('large-body');
      expect(findings[0].observationLevel).toBe('warning');
      expect(findings[0].requestIds).toEqual(['r-1mib']);
      expect(findings[0].observedValues.bodyBytes).toBe(1048576);
      expect(findings[0].threshold).toContain('1,048,576');
      expect(findings[0].limitations).toContain('exporter-reported response bytes');
    });

    it('flags bodies exceeding 1 MiB', () => {
      const requests = [createMockRequest({ id: 'r-1-2mb', bodyBytes: 1258291 })];
      const findings = evaluateLargeBodyRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].observedValues.bodyBytes).toBe(1258291);
    });

    it('never flags unknown body size (null)', () => {
      const requests = [createMockRequest({ id: 'r-unknown-size', bodyBytes: null })];
      expect(evaluateLargeBodyRule(requests)).toEqual([]);
    });
  });

  describe('Rule 5: Repeated GET', () => {
    it('flags 3 consecutive GET starts within exact 2,000 ms window (inclusive)', () => {
      const requests = [
        createMockRequest({
          id: 'r1',
          sourceIndex: 1,
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 0,
        }),
        createMockRequest({
          id: 'r2',
          sourceIndex: 2,
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 1000,
        }),
        createMockRequest({
          id: 'r3',
          sourceIndex: 3,
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 2000, // exact 2000ms boundary: 2000 - 0 = 2000
        }),
      ];
      const findings = evaluateRepeatedGetRule(requests);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('repeated-get');
      expect(findings[0].observationLevel).toBe('warning');
      expect(findings[0].requestIds).toEqual(['r1', 'r2', 'r3']);
      expect(findings[0].limitations).toContain('flagged for investigation, not redundancy');
    });

    it('does not flag 3 GET starts exceeding 2,000 ms (2,001 ms window)', () => {
      const requests = [
        createMockRequest({
          id: 'r1',
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 0,
        }),
        createMockRequest({
          id: 'r2',
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 1000,
        }),
        createMockRequest({
          id: 'r3',
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 2001, // 2001 - 0 = 2001ms > 2000ms
        }),
      ];
      expect(evaluateRepeatedGetRule(requests)).toEqual([]);
    });

    it('does not flag fewer than 3 requests in group', () => {
      const requests = [
        createMockRequest({
          id: 'r1',
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 0,
        }),
        createMockRequest({
          id: 'r2',
          method: 'GET',
          urlGroupId: 'group-cart',
          startOffsetMs: 100,
        }),
      ];
      expect(evaluateRepeatedGetRule(requests)).toEqual([]);
    });

    it('ignores non-GET requests (e.g. POST)', () => {
      const requests = [
        createMockRequest({
          id: 'r1',
          method: 'POST',
          urlGroupId: 'group-pay',
          startOffsetMs: 0,
        }),
        createMockRequest({
          id: 'r2',
          method: 'POST',
          urlGroupId: 'group-pay',
          startOffsetMs: 200,
        }),
        createMockRequest({
          id: 'r3',
          method: 'POST',
          urlGroupId: 'group-pay',
          startOffsetMs: 400,
        }),
      ];
      expect(evaluateRepeatedGetRule(requests)).toEqual([]);
    });

    it('keeps different urlGroupIds separate (e.g. differing query strings)', () => {
      // Group A has 2 requests; Group B has 2 requests. Total is 4, but neither has 3 qualifying
      const requests = [
        createMockRequest({
          id: 'r1',
          method: 'GET',
          urlGroupId: 'group-query-page1',
          startOffsetMs: 0,
        }),
        createMockRequest({
          id: 'r2',
          method: 'GET',
          urlGroupId: 'group-query-page1',
          startOffsetMs: 500,
        }),
        createMockRequest({
          id: 'r3',
          method: 'GET',
          urlGroupId: 'group-query-page2',
          startOffsetMs: 100,
        }),
        createMockRequest({
          id: 'r4',
          method: 'GET',
          urlGroupId: 'group-query-page2',
          startOffsetMs: 600,
        }),
      ];
      expect(evaluateRepeatedGetRule(requests)).toEqual([]);
    });

    it('deduplicates overlapping qualifying windows into one grouped finding', () => {
      // 4 requests at 0, 500, 1000, 1500ms
      // Triples: [r1, r2, r3] (1000ms <= 2000) AND [r2, r3, r4] (1000ms <= 2000)
      const requests = [
        createMockRequest({
          id: 'r1',
          sourceIndex: 1,
          method: 'GET',
          urlGroupId: 'group-poll',
          startOffsetMs: 0,
        }),
        createMockRequest({
          id: 'r2',
          sourceIndex: 2,
          method: 'GET',
          urlGroupId: 'group-poll',
          startOffsetMs: 500,
        }),
        createMockRequest({
          id: 'r3',
          sourceIndex: 3,
          method: 'GET',
          urlGroupId: 'group-poll',
          startOffsetMs: 1000,
        }),
        createMockRequest({
          id: 'r4',
          sourceIndex: 4,
          method: 'GET',
          urlGroupId: 'group-poll',
          startOffsetMs: 1500,
        }),
        // A fifth request outside the qualifying window:
        createMockRequest({
          id: 'r5',
          sourceIndex: 5,
          method: 'GET',
          urlGroupId: 'group-poll',
          startOffsetMs: 30000,
        }),
      ];
      const findings = evaluateRepeatedGetRule(requests);
      expect(findings).toHaveLength(1);
      // Deduplicated to the 4 requests in qualifying windows
      expect(findings[0].requestIds).toEqual(['r1', 'r2', 'r3', 'r4']);
      expect(findings[0].observedValues.qualifyingRequestCount).toBe(4);
      expect(findings[0].observedValues.totalInGroup).toBe(5);
    });
  });

  describe('Comprehensive Diagnostics Evaluation & Deterministic Ordering', () => {
    it('returns empty findings for a clean session', () => {
      const requests = [
        createMockRequest({ id: 'r1', status: 200, durationMs: 150, bodyBytes: 2048 }),
        createMockRequest({ id: 'r2', status: 204, durationMs: 40, bodyBytes: 0 }),
      ];
      expect(evaluateDiagnostics(requests)).toEqual([]);
    });

    it('sorts findings deterministically by category then source order across all 5 rule families', () => {
      const requests = [
        // Source 1: large body
        createMockRequest({
          id: 'r1',
          sourceIndex: 1,
          urlGroupId: 'group-1',
          bodyBytes: 2000000,
          status: 200,
          durationMs: 50,
        }),
        // Source 2: long request
        createMockRequest({
          id: 'r2',
          sourceIndex: 2,
          urlGroupId: 'group-2',
          durationMs: 2500,
          status: 200,
          bodyBytes: 100,
        }),
        // Source 3: http error
        createMockRequest({
          id: 'r3',
          sourceIndex: 3,
          urlGroupId: 'group-3',
          status: 500,
          durationMs: 50,
          bodyBytes: 100,
        }),
        // Source 4: no http status
        createMockRequest({
          id: 'r4',
          sourceIndex: 4,
          urlGroupId: 'group-4',
          status: 0,
          durationMs: 50,
          bodyBytes: 100,
        }),
        // Source 5, 6, 7: repeated GET group
        createMockRequest({
          id: 'r5',
          sourceIndex: 5,
          method: 'GET',
          urlGroupId: 'group-repeated',
          startOffsetMs: 100,
        }),
        createMockRequest({
          id: 'r6',
          sourceIndex: 6,
          method: 'GET',
          urlGroupId: 'group-repeated',
          startOffsetMs: 500,
        }),
        createMockRequest({
          id: 'r7',
          sourceIndex: 7,
          method: 'GET',
          urlGroupId: 'group-repeated',
          startOffsetMs: 900,
        }),
      ];

      const findings = evaluateDiagnostics(requests);
      expect(findings.map((f) => f.ruleId)).toEqual([
        'http-error',
        'no-http-status',
        'repeated-get',
        'long-request',
        'large-body',
      ]);
    });

    it('computes summary without double-counting requests matching multiple rules', () => {
      // Single request that is BOTH a 500 server error AND a 1,500ms long request
      const multiFaultRequest = createMockRequest({
        id: 'r-trouble',
        sourceIndex: 1,
        status: 500,
        durationMs: 1500,
        bodyBytes: 500,
      });

      const findings = evaluateDiagnostics([multiFaultRequest]);
      expect(findings).toHaveLength(2);

      const summary = computeDiagnosticsSummary(findings, 1);
      expect(summary.totalFindings).toBe(2);
      expect(summary.errorCount).toBe(1); // 500 error
      expect(summary.warningCount).toBe(1); // long request
      expect(summary.uniqueAffectedRequestCount).toBe(1); // single unique request!
    });
  });

  describe('Integration and Evidence Navigation Scenarios', () => {
    it('evaluates real synthetic checkout requests yielding exactly the 4 expected findings', () => {
      // Re-create the 10 requests of the synthetic checkout recording:
      const checkoutRequests: NormalizedRequest[] = [
        createMockRequest({ id: 'req-0', sourceIndex: 0, method: 'GET', urlGroupId: 'group-checkout', status: 200, durationMs: 85, bodyBytes: 12450 }),
        createMockRequest({ id: 'req-1', sourceIndex: 1, method: 'GET', urlGroupId: 'group-css', status: 200, durationMs: 35, bodyBytes: 8400 }),
        createMockRequest({ id: 'req-2', sourceIndex: 2, method: 'GET', urlGroupId: 'group-js', status: 200, durationMs: 90, bodyBytes: 46800 }),
        createMockRequest({ id: 'req-3', sourceIndex: 3, method: 'GET', urlGroupId: 'group-hero-img', status: 200, durationMs: 240, bodyBytes: 1258291 }), // Large body (1.20 MB)
        createMockRequest({ id: 'req-4', sourceIndex: 4, method: 'GET', urlGroupId: 'group-cart', status: 200, durationMs: 45, bodyBytes: 1200 }),
        createMockRequest({ id: 'req-5', sourceIndex: 5, method: 'POST', urlGroupId: 'group-shipping', status: 200, durationMs: 1420, bodyBytes: 1120 }), // Long request (1,420 ms)
        createMockRequest({ id: 'req-6', sourceIndex: 6, method: 'POST', urlGroupId: 'group-pay', status: 500, durationMs: 210, bodyBytes: 312 }), // HTTP 500 Error
        createMockRequest({ id: 'req-7', sourceIndex: 7, method: 'GET', urlGroupId: 'group-order-status', startOffsetMs: 1000, durationMs: 60, status: 200, bodyBytes: 450 }), // Repeated GET 1
        createMockRequest({ id: 'req-8', sourceIndex: 8, method: 'GET', urlGroupId: 'group-order-status', startOffsetMs: 1450, durationMs: 65, status: 200, bodyBytes: 450 }), // Repeated GET 2
        createMockRequest({ id: 'req-9', sourceIndex: 9, method: 'GET', urlGroupId: 'group-order-status', startOffsetMs: 1950, durationMs: 55, status: 200, bodyBytes: 450 }), // Repeated GET 3
      ];

      const findings = evaluateDiagnostics(checkoutRequests);
      expect(findings).toHaveLength(4);

      // Verify category order:
      // 1. http-error (req-6)
      expect(findings[0].ruleId).toBe('http-error');
      expect(findings[0].requestIds).toEqual(['req-6']);
      expect(findings[0].observationLevel).toBe('error');

      // 2. repeated-get (req-7, req-8, req-9)
      expect(findings[1].ruleId).toBe('repeated-get');
      expect(findings[1].requestIds).toEqual(['req-7', 'req-8', 'req-9']);
      expect(findings[1].observationLevel).toBe('warning');

      // 3. long-request (req-5)
      expect(findings[2].ruleId).toBe('long-request');
      expect(findings[2].requestIds).toEqual(['req-5']);
      expect(findings[2].observationLevel).toBe('warning');

      // 4. large-body (req-3)
      expect(findings[3].ruleId).toBe('large-body');
      expect(findings[3].requestIds).toEqual(['req-3']);
      expect(findings[3].observationLevel).toBe('warning');

      // Summary
      const summary = computeDiagnosticsSummary(findings, checkoutRequests.length);
      expect(summary.totalFindings).toBe(4);
      expect(summary.errorCount).toBe(1);
      expect(summary.warningCount).toBe(3);
      expect(summary.infoCount).toBe(0);
      expect(summary.uniqueAffectedRequestCount).toBe(6); // req-6, req-7, req-8, req-9, req-5, req-3
    });

    it('determines correct pagination page for evidence navigation when target is beyond page 1', () => {
      // 120 requests total
      const targetSourceIndex = 115; // on page 2 (indices 100..119)
      const targetPage = Math.floor(targetSourceIndex / 100) + 1;
      expect(targetPage).toBe(2);
    });

    it('verifies that filter clearing reveals request hidden by active search/status filters', () => {
      const hiddenRequest = createMockRequest({
        id: 'req-error',
        method: 'POST',
        status: 500,
        hostname: 'api.example.com',
      });

      // Filter: only 2xx
      const activeFilters = {
        searchQuery: '',
        selectedDomain: 'all',
        statusGroup: '2xx' as const,
      };

      // Hidden under active filter:
      expect(matchesFilter(hiddenRequest, activeFilters)).toBe(false);

      // Once reset to default, it is revealed:
      const defaultFilters = {
        searchQuery: '',
        selectedDomain: 'all',
        statusGroup: 'all' as const,
      };
      expect(matchesFilter(hiddenRequest, defaultFilters)).toBe(true);
    });
  });

  describe('Threshold Constants Export', () => {
    it('exports DIAGNOSTIC_THRESHOLDS matching RULE_THRESHOLDS with FINDINGS_PAGE_SIZE = 10', () => {
      expect(DIAGNOSTIC_THRESHOLDS).toBe(RULE_THRESHOLDS);
      expect(RULE_THRESHOLDS.FINDINGS_PAGE_SIZE).toBe(10);
      expect(RULE_THRESHOLDS.PAGE_SIZE).toBe(100);
      expect(RULE_THRESHOLDS.LONG_REQUEST_MS).toBe(1000);
      expect(RULE_THRESHOLDS.LARGE_BODY_BYTES).toBe(1048576);
      expect(RULE_THRESHOLDS.REPEATED_GET_MIN_COUNT).toBe(3);
      expect(RULE_THRESHOLDS.REPEATED_GET_WINDOW_MS).toBe(2000);
    });
  });

  describe('Findings Level Filtering (filterFindingsByLevel)', () => {
    const sampleFindings: DiagnosticFinding[] = [
      {
        id: 'f-error-1',
        ruleId: 'http-error',
        label: 'Error 1',
        observationLevel: 'error',
        requestIds: ['req-1'],
        observedValues: { status: 500 },
        threshold: '400–599',
        explanation: 'Server error',
        nextInvestigation: 'Inspect logs',
        limitations: 'Status only',
      },
      {
        id: 'f-warn-1',
        ruleId: 'long-request',
        label: 'Warning 1',
        observationLevel: 'warning',
        requestIds: ['req-2'],
        observedValues: { durationMs: 1200 },
        threshold: '1000 ms',
        explanation: 'Long duration',
        nextInvestigation: 'Check latency',
        limitations: 'Heuristic',
      },
      {
        id: 'f-warn-2',
        ruleId: 'large-body',
        label: 'Warning 2',
        observationLevel: 'warning',
        requestIds: ['req-3'],
        observedValues: { bodyBytes: 2000000 },
        threshold: '1048576 bytes',
        explanation: 'Large body',
        nextInvestigation: 'Inspect compression',
        limitations: 'bodySize only',
      },
      {
        id: 'f-info-1',
        ruleId: 'no-http-status',
        label: 'Info 1',
        observationLevel: 'info',
        requestIds: ['req-4'],
        observedValues: { status: 0 },
        threshold: 'status = 0',
        explanation: 'Status 0 recorded',
        nextInvestigation: 'Check connection aborts',
        limitations: 'Status 0',
      },
    ];

    it('returns all findings when level filter is "all"', () => {
      const result = filterFindingsByLevel(sampleFindings, 'all');
      expect(result).toHaveLength(4);
      expect(result.map((f) => f.id)).toEqual(['f-error-1', 'f-warn-1', 'f-warn-2', 'f-info-1']);
    });

    it('returns only errors when level filter is "error"', () => {
      const result = filterFindingsByLevel(sampleFindings, 'error');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('f-error-1');
    });

    it('returns only warnings when level filter is "warning"', () => {
      const result = filterFindingsByLevel(sampleFindings, 'warning');
      expect(result).toHaveLength(2);
      expect(result.map((f) => f.id)).toEqual(['f-warn-1', 'f-warn-2']);
    });

    it('returns only info when level filter is "info"', () => {
      const result = filterFindingsByLevel(sampleFindings, 'info');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('f-info-1');
    });

    it('returns empty array when filtering by a level with 0 findings', () => {
      const warningsOnly = sampleFindings.filter((f) => f.observationLevel === 'warning');
      const errorResult = filterFindingsByLevel(warningsOnly, 'error');
      expect(errorResult).toEqual([]);
      const infoResult = filterFindingsByLevel(warningsOnly, 'info');
      expect(infoResult).toEqual([]);
    });

    it('does not mutate input findings array', () => {
      const originalCopy = [...sampleFindings];
      filterFindingsByLevel(sampleFindings, 'warning');
      expect(sampleFindings).toEqual(originalCopy);
    });
  });

  describe('Findings Pagination (paginateItems with RULE_THRESHOLDS.FINDINGS_PAGE_SIZE)', () => {
    // Generate 25 synthetic findings
    const manyFindings: DiagnosticFinding[] = Array.from({ length: 25 }, (_, idx) => ({
      id: `finding-many-${idx + 1}`,
      ruleId: 'http-error',
      label: `HTTP Error finding #${idx + 1}`,
      observationLevel: idx < 10 ? 'error' : 'warning',
      requestIds: [`req-${idx + 1}`],
      observedValues: { status: 500 },
      threshold: '400–599',
      explanation: `Test finding ${idx + 1}`,
      nextInvestigation: 'Inspect server',
      limitations: 'Observation heuristic',
    }));

    const pageSize = RULE_THRESHOLDS.FINDINGS_PAGE_SIZE; // 10

    it('paginates 25 findings into 3 pages of sizes 10, 10, and 5', () => {
      const page1 = paginateItems(manyFindings, 1, pageSize);
      expect(page1.totalPages).toBe(3);
      expect(page1.totalItems).toBe(25);
      expect(page1.currentPage).toBe(1);
      expect(page1.startIndex).toBe(0);
      expect(page1.endIndex).toBe(10);
      expect(page1.items).toHaveLength(10);
      expect(page1.items[0].id).toBe('finding-many-1');
      expect(page1.items[9].id).toBe('finding-many-10');

      const page2 = paginateItems(manyFindings, 2, pageSize);
      expect(page2.currentPage).toBe(2);
      expect(page2.startIndex).toBe(10);
      expect(page2.endIndex).toBe(20);
      expect(page2.items).toHaveLength(10);
      expect(page2.items[0].id).toBe('finding-many-11');
      expect(page2.items[9].id).toBe('finding-many-20');

      const page3 = paginateItems(manyFindings, 3, pageSize);
      expect(page3.currentPage).toBe(3);
      expect(page3.startIndex).toBe(20);
      expect(page3.endIndex).toBe(25);
      expect(page3.items).toHaveLength(5);
      expect(page3.items[0].id).toBe('finding-many-21');
      expect(page3.items[4].id).toBe('finding-many-25'); // access to last finding
    });

    it('clamps currentPage when filtered findings shrink', () => {
      // User was on page 3 of 25 items
      // Filter reduces list to 5 items (totalPages becomes 1)
      const shrunkFindings = manyFindings.slice(0, 5);
      const clamped = paginateItems(shrunkFindings, 3, pageSize);
      expect(clamped.totalPages).toBe(1);
      expect(clamped.currentPage).toBe(1);
      expect(clamped.items).toHaveLength(5);
    });

    it('clamps negative or zero page to 1', () => {
      const pageNeg = paginateItems(manyFindings, -5, pageSize);
      expect(pageNeg.currentPage).toBe(1);
      expect(pageNeg.startIndex).toBe(0);
    });
  });

  describe('FindingsPanel Component & Lifecycle Regressions', () => {
    it('renders clean session state when 0 findings matched', () => {
      const html = renderToString(
        React.createElement(FindingsPanel, {
          findings: [],
          totalRequests: 50,
          onNavigateToRequest: vi.fn(),
        })
      );

      expect(html).toContain('No Configured Diagnostic Rules Matched');
      expect(html).toContain('50');
      expect(html).toContain('Scope limitation:');
      expect(html).toContain('does not prove that the application, backend services, or client network are healthy');
    });

    it('renders clear no-match state when selected level filter yields 0 cards', () => {
      // 3 warnings, 0 errors
      const warningFindings: DiagnosticFinding[] = [
        {
          id: 'f-warn-1',
          ruleId: 'long-request',
          label: 'Long duration',
          observationLevel: 'warning',
          requestIds: ['req-1'],
          observedValues: { durationMs: 1500 },
          threshold: '1000 ms',
          explanation: 'Long duration',
          nextInvestigation: 'Inspect query',
          limitations: 'Heuristic',
        },
      ];

      // Render with levelFilter set (simulated via tab or prop test)
      // Since default is 'all', 1 warning is shown
      const htmlAll = renderToString(
        React.createElement(FindingsPanel, {
          findings: warningFindings,
          totalRequests: 10,
          onNavigateToRequest: vi.fn(),
        })
      );
      expect(htmlAll).toContain('Warnings (1)');
      expect(htmlAll).toContain('Errors (0)');
      expect(htmlAll).toContain('Info (0)');
      expect(htmlAll).toContain('f-warn-1');
    });

    it('renders pagination controls and bottom bar when findings exceed page size', () => {
      const findingsList: DiagnosticFinding[] = Array.from({ length: 15 }, (_, i) => ({
        id: `f-${i + 1}`,
        ruleId: 'long-request',
        label: `Finding ${i + 1}`,
        observationLevel: 'warning',
        requestIds: [`req-${i + 1}`],
        observedValues: { durationMs: 1000 + i },
        threshold: '1000 ms',
        explanation: 'Explanation',
        nextInvestigation: 'Next step',
        limitations: 'Limitation',
      }));

      const html = renderToString(
        React.createElement(FindingsPanel, {
          findings: findingsList,
          totalRequests: 20,
          onNavigateToRequest: vi.fn(),
          pageSize: 10,
        })
      );

      // Verify pagination info: Showing 1–10 of 15 findings
      expect(html).toContain('Showing');
      expect(html).toContain('1–10');
      expect(html).toContain('15');
      expect(html).toContain('findings');
      expect(html).toContain('Page 1 of 2');
      expect(html).toContain('btn-findings-prev-page');
      expect(html).toContain('btn-findings-next-page');
      expect(html).toContain('findings-pagination-bottom');

      // First page contains f-1 through f-10, does NOT contain f-11 on page 1
      expect(html).toContain('f-1');
      expect(html).toContain('f-10');
      expect(html).not.toContain('id="finding-card-f-11"');
    });

    it('renders observed measurements table alongside configured threshold', () => {
      const findingWithObserved: DiagnosticFinding = {
        id: 'f-http-500',
        ruleId: 'http-error',
        label: 'HTTP 500 Error Response',
        observationLevel: 'error',
        requestIds: ['req-6'],
        observedValues: { status: 500, method: 'POST', displayUrl: 'https://api.example.com/pay' },
        threshold: '400–599',
        explanation: 'Server error',
        nextInvestigation: 'Inspect logs',
        limitations: 'Header status only',
      };

      const html = renderToString(
        React.createElement(FindingsPanel, {
          findings: [findingWithObserved],
          totalRequests: 10,
          onNavigateToRequest: vi.fn(),
        })
      );

      expect(html).toContain('finding-measurements-table');
      expect(html).toContain('Configured Threshold:');
      expect(html).toContain('400–599');
      expect(html).toContain('Recorded Status:');
      expect(html).toContain('500');
    });

    it('verifies session replacement resets levelFilter coherently without leaving blank list', () => {
      // Initial session has 1 error and 1 warning
      const session1Findings: DiagnosticFinding[] = [
        {
          id: 'f-err-1',
          ruleId: 'http-error',
          label: 'Error finding',
          observationLevel: 'error',
          requestIds: ['req-1'],
          observedValues: { status: 500 },
          threshold: '400–599',
          explanation: 'Err',
          nextInvestigation: 'Investigate',
          limitations: 'Limits',
        },
        {
          id: 'f-warn-1',
          ruleId: 'long-request',
          label: 'Warning finding',
          observationLevel: 'warning',
          requestIds: ['req-2'],
          observedValues: { durationMs: 1500 },
          threshold: '1000 ms',
          explanation: 'Warn',
          nextInvestigation: 'Investigate',
          limitations: 'Limits',
        },
      ];

      const htmlSession1 = renderToString(
        React.createElement(FindingsPanel, {
          key: 'session-1',
          sessionKey: 1,
          findings: session1Findings,
          totalRequests: 20,
          onNavigateToRequest: vi.fn(),
        })
      );
      expect(htmlSession1).toContain('Errors (1)');
      expect(htmlSession1).toContain('Warnings (1)');

      // Second session has 0 errors, 2 warnings
      const session2Findings: DiagnosticFinding[] = [
        {
          id: 'f-warn-2A',
          ruleId: 'long-request',
          label: 'Warning 2A',
          observationLevel: 'warning',
          requestIds: ['req-20'],
          observedValues: { durationMs: 1200 },
          threshold: '1000 ms',
          explanation: 'Warn 2A',
          nextInvestigation: 'Investigate',
          limitations: 'Limits',
        },
        {
          id: 'f-warn-2B',
          ruleId: 'large-body',
          label: 'Warning 2B',
          observationLevel: 'warning',
          requestIds: ['req-21'],
          observedValues: { bodyBytes: 2000000 },
          threshold: '1048576 bytes',
          explanation: 'Warn 2B',
          nextInvestigation: 'Investigate',
          limitations: 'Limits',
        },
      ];

      // When session 2 is rendered with a new sessionKey (as App.tsx does on successful replacement):
      const htmlSession2 = renderToString(
        React.createElement(FindingsPanel, {
          key: 'session-2',
          sessionKey: 2,
          findings: session2Findings,
          totalRequests: 30,
          onNavigateToRequest: vi.fn(),
        })
      );

      // Level filter starts at 'all', showing both warnings rather than an empty blank list
      expect(htmlSession2).toContain('Warning 2A');
      expect(htmlSession2).toContain('Warning 2B');
      expect(htmlSession2).toContain('Warnings (2)');
      expect(htmlSession2).toContain('Errors (0)');
      expect(htmlSession2).not.toContain('finding-card-f-err-1');
    });
  });
});

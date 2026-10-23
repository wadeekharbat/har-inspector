import { describe, it, expect } from 'vitest';
import { parseHarData, parseHarContent } from './parser';
import { RULE_THRESHOLDS } from './types';
import syntheticCheckoutFixture from '../fixtures/synthetic-checkout.har.json';

describe('HAR Parser & Normalizer ()', () => {
  // 1. Valid synthetic fixture
  it('parses the valid synthetic checkout fixture with accurate totals and timeline', () => {
    const result = parseHarData(syntheticCheckoutFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const { session } = result;
    expect(session.requests).toHaveLength(10);
    expect(session.stats.totalRawEntries).toBe(10);
    expect(session.stats.acceptedEntries).toBe(10);
    expect(session.stats.skippedEntries).toBe(0);

    // Ground truth: 1,330,683 bytes
    expect(session.stats.knownBodyBytesTotal).toBe(1330683);
    expect(session.stats.unknownBodyBytesCount).toBe(0);

    // Timeline origin and span
    expect(session.timeline.originTimestampMs).toBe(Date.parse('2026-10-22T10:00:00.000Z'));
    expect(session.timeline.totalSpanMs).toBe(4002);

    // HTTP errors (req-4 is 500)
    expect(session.stats.httpErrorCount).toBe(1);
    expect(session.stats.unknownStatusCount).toBe(0);
  });

  // 2. Invalid JSON and missing log/entries
  it('rejects invalid JSON string and missing log / entries array without leaking raw content', () => {
    const badJson = parseHarContent('{ malformed json');
    expect(badJson.success).toBe(false);
    if (!badJson.success) {
      expect(badJson.error).toBe('Invalid JSON format: file content could not be parsed as valid JSON.');
    }

    // Regression: raw input containing synthetic secrets must not leak through JSON parse error
    const secretInput = 'SECRET_QUERY_TOKEN is not valid json';
    const secretResult = parseHarContent(secretInput);
    expect(secretResult.success).toBe(false);
    if (!secretResult.success) {
      expect(secretResult.error).toBe('Invalid JSON format: file content could not be parsed as valid JSON.');
      expect(secretResult.error).not.toContain('SECRET');
      expect(secretResult.error).not.toContain('TOKEN');
    }

    expect(parseHarData(null).success).toBe(false);
    expect(parseHarData([]).success).toBe(false);
    expect(parseHarData('string').success).toBe(false);

    const missingLog = parseHarData({});
    expect(missingLog.success).toBe(false);
    if (!missingLog.success) {
      expect(missingLog.error).toContain('missing "log" object');
    }

    const missingEntries = parseHarData({ log: {} });
    expect(missingEntries.success).toBe(false);
    if (!missingEntries.success) {
      expect(missingEntries.error).toContain('missing or invalid "log.entries" array');
    }

    const nonArrayEntries = parseHarData({ log: { entries: 'invalid' } });
    expect(nonArrayEntries.success).toBe(false);
  });

  // 3. Empty entries
  it('handles empty entries recording cleanly with null timeline origin', () => {
    const result = parseHarData({ log: { version: '1.2', entries: [] } });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.session.requests).toHaveLength(0);
    expect(result.session.stats.totalRawEntries).toBe(0);
    expect(result.session.stats.acceptedEntries).toBe(0);
    expect(result.session.stats.skippedEntries).toBe(0);
    expect(result.session.timeline.originTimestampMs).toBeNull();
    expect(result.session.timeline.totalSpanMs).toBe(0);
  });

  // 4. Some and all malformed entries
  it('skips partially malformed entries with aggregate warning and rejects when all are malformed', () => {
    // 3 entries: 1 valid, 1 missing method, 1 missing response
    const partialData = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00.000Z',
            time: 100,
            request: { method: 'GET', url: 'https://example.com/valid' },
            response: { status: 200, bodySize: 50 },
          },
          {
            startedDateTime: '2026-10-22T10:00:01.000Z',
            time: 100,
            request: { method: '', url: 'https://example.com/bad-method' }, // empty method
            response: { status: 200, bodySize: 50 },
          },
          {
            startedDateTime: '2026-10-22T10:00:02.000Z',
            time: 100,
            request: { method: 'GET', url: 'https://example.com/missing-res' },
            // missing response
          },
        ],
      },
    };

    const partialResult = parseHarData(partialData);
    expect(partialResult.success).toBe(true);
    if (partialResult.success) {
      expect(partialResult.session.requests).toHaveLength(1);
      expect(partialResult.session.stats.totalRawEntries).toBe(3);
      expect(partialResult.session.stats.acceptedEntries).toBe(1);
      expect(partialResult.session.stats.skippedEntries).toBe(2);
      const skippedWarning = partialResult.session.warnings.find((w) => w.code === 'SKIPPED_ENTRIES');
      expect(skippedWarning).toBeDefined();
      expect(skippedWarning?.affectedCount).toBe(2);
    }

    // All malformed entries
    const allBadData = {
      log: {
        version: '1.2',
        entries: [
          { invalid: true },
          { startedDateTime: 'not a date' },
        ],
      },
    };

    const allBadResult = parseHarData(allBadData);
    expect(allBadResult.success).toBe(false);
    if (!allBadResult.success) {
      expect(allBadResult.error).toContain('no usable HTTP entries');
      expect(allBadResult.error).toContain('2 entry/entries skipped');
    }
  });

  // 5. Missing optional metadata
  it('accepts entries missing optional metadata fields without failure', () => {
    const minimalHar = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T12:00:00Z',
            time: 150,
            request: { method: 'GET', url: 'https://example.com/minimal' },
            response: { status: 200, bodySize: 400 },
          },
        ],
      },
    };

    const result = parseHarData(minimalHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const req = result.session.requests[0];
    expect(req.method).toBe('GET');
    expect(req.displayUrl).toBe('https://example.com/minimal');
    expect(req.durationMs).toBe(150);
    expect(req.bodyBytes).toBe(400);
    expect(req.mimeType).toBeNull();
    expect(req.timings).toBeNull();
    expect(req.warnings).toHaveLength(0);
  });

  // 6. Version warning
  it('generates a compatibility warning when HAR version is missing or differs from 1.2', () => {
    const noVersionHar = {
      log: {
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/test' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    };

    const res1 = parseHarData(noVersionHar);
    expect(res1.success).toBe(true);
    if (res1.success) {
      const verWarning = res1.session.warnings.find((w) => w.code === 'COMPATIBILITY_VERSION');
      expect(verWarning).toBeDefined();
      expect(verWarning?.message).toContain('unspecified');
    }

    const har11 = {
      log: {
        version: '1.1',
        entries: noVersionHar.log.entries,
      },
    };
    const res2 = parseHarData(har11);
    expect(res2.success).toBe(true);
    if (res2.success) {
      const verWarning = res2.session.warnings.find((w) => w.code === 'COMPATIBILITY_VERSION');
      expect(verWarning).toBeDefined();
      expect(verWarning?.message).toContain('1.1');
    }
  });

  // 7. UTF-8 BOM
  it('ignores a leading UTF-8 BOM when parsing raw content', () => {
    const rawHar = JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/bom-test' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    });

    const withBom = '\uFEFF' + rawHar;
    const result = parseHarContent(withBom);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.requests[0].displayUrl).toBe('https://example.com/bom-test');
    }
  });

  // 8. Unsorted timestamps
  it('calculates timeline origin from earliest timestamp regardless of entry order and preserves source index', () => {
    const unsortedHar = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:05:00.000Z', // +300,000 ms
            time: 200,
            request: { method: 'GET', url: 'https://example.com/second' },
            response: { status: 200, bodySize: 100 },
          },
          {
            startedDateTime: '2026-10-22T10:00:00.000Z', // earliest (origin)
            time: 1000,
            request: { method: 'GET', url: 'https://example.com/first' },
            response: { status: 200, bodySize: 100 },
          },
        ],
      },
    };

    const result = parseHarData(unsortedHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.session.timeline.originTimestampMs).toBe(Date.parse('2026-10-22T10:00:00.000Z'));
    expect(result.session.timeline.totalSpanMs).toBe(300200); // 300000 + 200

    const req0 = result.session.requests[0];
    const req1 = result.session.requests[1];

    expect(req0.sourceIndex).toBe(0);
    expect(req0.id).toBe('req-0');
    expect(req0.startOffsetMs).toBe(300000);

    expect(req1.sourceIndex).toBe(1);
    expect(req1.id).toBe('req-1');
    expect(req1.startOffsetMs).toBe(0);
  });

  // 9. Timezone conversion
  it('converts differing timezone offsets to the identical UTC instant', () => {
    const timezoneHar = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00.000Z', // UTC 10:00
            time: 100,
            request: { method: 'GET', url: 'https://example.com/utc' },
            response: { status: 200, bodySize: 10 },
          },
          {
            startedDateTime: '2026-10-22T13:00:00.000+03:00', // Riyadh (UTC 10:00)
            time: 100,
            request: { method: 'GET', url: 'https://example.com/riyadh' },
            response: { status: 200, bodySize: 10 },
          },
          {
            startedDateTime: '2026-10-22T05:00:00.000-05:00', // New York (UTC 10:00)
            time: 100,
            request: { method: 'GET', url: 'https://example.com/ny' },
            response: { status: 200, bodySize: 10 },
          },
          {
            startedDateTime: '2026-10-22T14:00:00.000+03:00', // Riyadh (UTC 11:00 = +3600000 ms)
            time: 100,
            request: { method: 'GET', url: 'https://example.com/later' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    };

    const result = parseHarData(timezoneHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const reqs = result.session.requests;
    expect(reqs[0].startOffsetMs).toBe(0);
    expect(reqs[1].startOffsetMs).toBe(0);
    expect(reqs[2].startOffsetMs).toBe(0);
    expect(reqs[3].startOffsetMs).toBe(3600000);
  });

  it('rejects date-only and timezone-less datetime strings while preserving valid timestamps with timezones', () => {
    // Mixed valid/invalid entries
    const mixedDatesHar = {
      log: {
        version: '1.2',
        entries: [
          {
            // Valid with Z
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/valid-z' },
            response: { status: 200, bodySize: 10 },
          },
          {
            // Invalid: Date-only (reproduced bug where -22 was parsed as offset)
            startedDateTime: '2026-10-22',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/date-only' },
            response: { status: 200, bodySize: 10 },
          },
          {
            // Invalid: Timezone-less datetime
            startedDateTime: '2026-10-22T10:00:00',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/no-tz' },
            response: { status: 200, bodySize: 10 },
          },
          {
            // Invalid: Timezone-less datetime with fractional seconds
            startedDateTime: '2026-10-22T10:00:00.123',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/no-tz-ms' },
            response: { status: 200, bodySize: 10 },
          },
          {
            // Valid with explicit +03:00 offset
            startedDateTime: '2026-10-22T13:00:00+03:00',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/valid-offset' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    };

    const mixedResult = parseHarData(mixedDatesHar);
    expect(mixedResult.success).toBe(true);
    if (mixedResult.success) {
      expect(mixedResult.session.requests).toHaveLength(2);
      expect(mixedResult.session.stats.acceptedEntries).toBe(2);
      expect(mixedResult.session.stats.skippedEntries).toBe(3);
      expect(mixedResult.session.requests[0].displayUrl).toBe('https://example.com/valid-z');
      expect(mixedResult.session.requests[1].displayUrl).toBe('https://example.com/valid-offset');
      const skippedWarning = mixedResult.session.warnings.find((w) => w.code === 'SKIPPED_ENTRIES');
      expect(skippedWarning).toBeDefined();
      expect(skippedWarning?.affectedCount).toBe(3);
    }

    // All invalid datetimes (e.g. all date-only entries)
    const allDateOnlyHar = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/one' },
            response: { status: 200, bodySize: 10 },
          },
          {
            startedDateTime: '2026-10-23',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/two' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    };

    const allInvalidResult = parseHarData(allDateOnlyHar);
    expect(allInvalidResult.success).toBe(false);
    if (!allInvalidResult.success) {
      expect(allInvalidResult.error).toContain('no usable HTTP entries');
      expect(allInvalidResult.error).toContain('2 entry/entries skipped');
    }
  });

  // 10. Zero / unknown / negative timings and sizes
  it('correctly handles zero, negative, and missing durations, body sizes, and phase timings', () => {
    const timingsHar = {
      log: {
        version: '1.2',
        entries: [
          {
            // Valid zero duration and bodySize
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 0,
            request: { method: 'GET', url: 'https://example.com/zeros' },
            response: { status: 200, bodySize: 0 },
            timings: { send: 0, wait: 0, receive: 0 },
          },
          {
            // Negative / unknown duration and bodySize
            startedDateTime: '2026-10-22T10:00:01Z',
            time: -1,
            request: { method: 'GET', url: 'https://example.com/unknowns' },
            response: { status: 200, bodySize: -1 },
            timings: { send: -1, wait: -1, receive: 20, ssl: -1 },
          },
        ],
      },
    };

    const result = parseHarData(timingsHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const req0 = result.session.requests[0];
    expect(req0.durationMs).toBe(0); // Valid zero preserved
    expect(req0.bodyBytes).toBe(0); // Valid zero preserved
    expect(req0.timings?.send).toBe(0);
    expect(req0.warnings).toHaveLength(0);

    const req1 = result.session.requests[1];
    expect(req1.durationMs).toBeNull(); // Negative becomes null
    expect(req1.bodyBytes).toBeNull(); // Negative becomes null
    expect(req1.timings?.send).toBeNull();
    expect(req1.timings?.receive).toBe(20);
    expect(req1.timings?.ssl).toBeNull();

    expect(req1.warnings.some((w) => w.code === 'UNKNOWN_DURATION')).toBe(true);
    expect(req1.warnings.some((w) => w.code === 'UNKNOWN_BODY_SIZE')).toBe(true);
  });

  // 11. Status 0 vs null
  it('distinguishes status 0 (no HTTP status recorded) from null/invalid status', () => {
    const statusHar = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 100,
            request: { method: 'GET', url: 'https://example.com/status-zero' },
            response: { status: 0, bodySize: 0 },
          },
          {
            startedDateTime: '2026-10-22T10:00:01Z',
            time: 100,
            request: { method: 'GET', url: 'https://example.com/status-invalid' },
            response: { status: 700, bodySize: 0 }, // Out of 0-599
          },
          {
            startedDateTime: '2026-10-22T10:00:02Z',
            time: 100,
            request: { method: 'GET', url: 'https://example.com/status-missing' },
            response: { status: null, bodySize: 0 }, // Missing
          },
        ],
      },
    };

    const result = parseHarData(statusHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const req0 = result.session.requests[0];
    expect(req0.status).toBe(0);
    expect(req0.warnings.some((w) => w.code === 'INVALID_STATUS')).toBe(false);

    const req1 = result.session.requests[1];
    expect(req1.status).toBeNull();
    expect(req1.warnings.some((w) => w.code === 'INVALID_STATUS')).toBe(true);

    const req2 = result.session.requests[2];
    expect(req2.status).toBeNull();
    expect(req2.warnings.some((w) => w.code === 'INVALID_STATUS')).toBe(true);

    // Summary stats: status 0 is NOT counted as unknownStatusCount
    expect(result.session.stats.unknownStatusCount).toBe(2);
    expect(result.session.stats.httpErrorCount).toBe(0);
  });

  // 12. Malformed URLs
  it('skips entries with malformed or unsupported non-HTTP(S) URLs', () => {
    const badUrlHar = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 100,
            request: { method: 'GET', url: 'not-a-valid-url' },
            response: { status: 200, bodySize: 10 },
          },
          {
            startedDateTime: '2026-10-22T10:00:01Z',
            time: 100,
            request: { method: 'GET', url: 'ftp://ftp.example.com/file.txt' },
            response: { status: 200, bodySize: 10 },
          },
          {
            startedDateTime: '2026-10-22T10:00:02Z',
            time: 100,
            request: { method: 'GET', url: 'https://example.com/valid' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    };

    const result = parseHarData(badUrlHar);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.requests).toHaveLength(1);
      expect(result.session.stats.acceptedEntries).toBe(1);
      expect(result.session.stats.skippedEntries).toBe(2);
    }
  });

  // 13. Unknown extensions
  it('ignores arbitrary extension fields and does not leak them into normalized state', () => {
    const extensionHar = {
      log: {
        version: '1.2',
        _customRootProp: { secretTelemetry: 'do_not_retain' },
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 100,
            _initiator: { type: 'parser', lineNumber: 42 },
            _priority: 'VeryHigh',
            request: {
              method: 'GET',
              url: 'https://example.com/ext',
              _customRequestProp: 'secret',
            },
            response: {
              status: 200,
              bodySize: 10,
              _customResponseProp: 'ignore',
            },
          },
        ],
      },
    };

    const result = parseHarData(extensionHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const req = result.session.requests[0];
    expect((req as unknown as Record<string, unknown>)._initiator).toBeUndefined();
    expect((req as unknown as Record<string, unknown>)._priority).toBeUndefined();
    expect((req as unknown as Record<string, unknown>)._customRequestProp).toBeUndefined();
  });

  // 14. Exact file and entry boundaries and over-limit refusal
  it('enforces exact raw entry boundary (2,000 accepted, 2,001 rejected)', () => {
    const makeEntries = (count: number) => {
      const entries = [];
      for (let i = 0; i < count; i++) {
        entries.push({
          startedDateTime: '2026-10-22T10:00:00.000Z',
          time: 10,
          request: { method: 'GET', url: `https://example.com/item-${i}` },
          response: { status: 200, bodySize: 10 },
        });
      }
      return entries;
    };

    // Boundary: exactly 2,000 raw entries is accepted
    const boundaryHar = { log: { version: '1.2', entries: makeEntries(RULE_THRESHOLDS.MAX_RAW_ENTRIES) } };
    const boundaryResult = parseHarData(boundaryHar);
    expect(boundaryResult.success).toBe(true);
    if (boundaryResult.success) {
      expect(boundaryResult.session.requests).toHaveLength(2000);
    }

    // Over limit: 2,001 raw entries is rejected before normalization
    const overLimitHar = { log: { version: '1.2', entries: makeEntries(RULE_THRESHOLDS.MAX_RAW_ENTRIES + 1) } };
    const overLimitResult = parseHarData(overLimitHar);
    expect(overLimitResult.success).toBe(false);
    if (!overLimitResult.success) {
      expect(overLimitResult.error).toContain('2,001 entries');
      expect(overLimitResult.error).toContain('maximum limit of 2,000 raw entries');
    }
  });

  it('enforces exact file size boundary (10,485,760 bytes accepted, 10,485,761 bytes rejected)', () => {
    const validJson = JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 10,
            request: { method: 'GET', url: 'https://example.com/ok' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    });

    // Exact limit: 10,485,760 bytes
    const exactLimitResult = parseHarContent(validJson, RULE_THRESHOLDS.MAX_FILE_BYTES);
    expect(exactLimitResult.success).toBe(true);

    // Over limit: 10,485,761 bytes
    const overLimitResult = parseHarContent(validJson, RULE_THRESHOLDS.MAX_FILE_BYTES + 1);
    expect(overLimitResult.success).toBe(false);
    if (!overLimitResult.success) {
      expect(overLimitResult.error).toContain('10,485,761 bytes');
      expect(overLimitResult.error).toContain('10 MiB limit');
    }
  });

  // 15. Sensitive fields and privacy guarantees
  it('strips credentials, query values, fragments, headers, cookies, and bodies from normalized state', () => {
    const rawSensitiveHar = {
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00.000Z',
            time: 250,
            request: {
              method: 'POST',
              url: 'https://admin:super-secret-pw@checkout.example.com/pay?token=secret-token-123&cvv=999#step3',
              headers: [
                { name: 'Authorization', value: 'Bearer top-secret-oauth-token' },
                { name: 'Cookie', value: 'sessionId=secret-session-id' },
              ],
              postData: {
                mimeType: 'application/json',
                text: '{"creditCard":"4111222233334444","password":"super-secret-user-pw"}',
              },
            },
            response: {
              status: 200,
              statusText: 'OK',
              bodySize: 1024,
              headers: [
                { name: 'Set-Cookie', value: 'admin_id=sensitive_cookie_value' },
              ],
              content: {
                size: 2048,
                mimeType: 'application/json',
                text: '{"secretData":"do_not_leak_payload_text"}',
              },
            },
          },
        ],
      },
    };

    const result = parseHarData(rawSensitiveHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const req = result.session.requests[0];

    // displayUrl strips credentials, fragment, and replaces entire query with ?query_omitted
    expect(req.displayUrl).toBe('https://checkout.example.com/pay?query_omitted');
    expect(req.hostname).toBe('checkout.example.com');
    expect(req.origin).toBe('https://checkout.example.com');

    // Serialize entire session to JSON string to ensure no raw secrets leaked anywhere
    const sessionJson = JSON.stringify(result.session);

    const sensitiveSubstrings = [
      'admin:',
      'super-secret-pw',
      'token=secret-token-123',
      'cvv=999',
      'step3',
      'Bearer top-secret-oauth-token',
      'sessionId=secret-session-id',
      '4111222233334444',
      'super-secret-user-pw',
      'sensitive_cookie_value',
      'do_not_leak_payload_text',
    ];

    for (const secret of sensitiveSubstrings) {
      expect(sessionJson).not.toContain(secret);
    }
  });

  // 16. Ephemeral grouping distinct across differing queries
  it('assigns distinct urlGroupId to requests sharing the same sanitized path but differing queries, and matching group IDs to identical queries', () => {
    const groupingHar = {
      log: {
        version: '1.2',
        entries: [
          {
            // Request 0: GET search?q=shoes
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/api/search?q=shoes' },
            response: { status: 200, bodySize: 100 },
          },
          {
            // Request 1: GET search?q=hats (different query)
            startedDateTime: '2026-10-22T10:00:01Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/api/search?q=hats' },
            response: { status: 200, bodySize: 100 },
          },
          {
            // Request 2: GET search?q=shoes (identical query to Req 0)
            startedDateTime: '2026-10-22T10:00:02Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/api/search?q=shoes' },
            response: { status: 200, bodySize: 100 },
          },
          {
            // Request 3: POST search?q=shoes (different method)
            startedDateTime: '2026-10-22T10:00:03Z',
            time: 50,
            request: { method: 'POST', url: 'https://example.com/api/search?q=shoes' },
            response: { status: 200, bodySize: 100 },
          },
        ],
      },
    };

    const result = parseHarData(groupingHar);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const reqs = result.session.requests;

    // All four share the same sanitized displayUrl
    expect(reqs[0].displayUrl).toBe('https://example.com/api/search?query_omitted');
    expect(reqs[1].displayUrl).toBe('https://example.com/api/search?query_omitted');
    expect(reqs[2].displayUrl).toBe('https://example.com/api/search?query_omitted');
    expect(reqs[3].displayUrl).toBe('https://example.com/api/search?query_omitted');

    // Req 0 and Req 2 match group IDs
    expect(reqs[0].urlGroupId).toBe(reqs[2].urlGroupId);

    // Req 1 has different query -> distinct group ID
    expect(reqs[0].urlGroupId).not.toBe(reqs[1].urlGroupId);

    // Req 3 has different method -> distinct group ID
    expect(reqs[0].urlGroupId).not.toBe(reqs[3].urlGroupId);

    // Raw query parameter names or values are never in urlGroupId
    expect(reqs[0].urlGroupId).not.toContain('shoes');
    expect(reqs[1].urlGroupId).not.toContain('hats');
  });
});

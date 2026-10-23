import { describe, it, expect } from 'vitest';
import { parseHarData } from './parser';
import { ImportController, type ImportableFile } from './import-controller';
import { filterRequests, sortRequests } from './explorer';
import { evaluateDiagnostics } from './diagnostics';
import { RULE_THRESHOLDS } from './types';
import { generateDeterministicHar } from '../fixtures/generate-scale-fixture';

describe('', () => {
  describe('File Size Boundaries (10 MiB = 10,485,760 bytes)', () => {
    it('accepts a file of exact limit 10,485,760 bytes (10 MiB)', async () => {
      const exactHar = generateDeterministicHar({ entryCount: 1 });
      const serialized = JSON.stringify(exactHar);

      const controller = new ImportController();
      let textReadCalled = false;
      const file: ImportableFile = {
        name: 'file-limit-exact.har',
        size: RULE_THRESHOLDS.MAX_FILE_BYTES, // Exactly 10,485,760 bytes
        text: async () => {
          textReadCalled = true;
          return serialized;
        },
      };

      const success = await controller.importFile(file);
      expect(textReadCalled).toBe(true);
      expect(success).toBe(true);
      expect(controller.getState().status).toBe('success');
      expect(controller.getState().error).toBeNull();
      expect(controller.getState().currentSession?.requests).toHaveLength(1);
    });

    it('rejects a file of 10,485,761 bytes (10 MiB + 1 byte) before reading into memory', async () => {
      const controller = new ImportController();
      let textReadCalled = false;
      const file: ImportableFile = {
        name: 'file-limit-over.har',
        size: RULE_THRESHOLDS.MAX_FILE_BYTES + 1, // 10,485,761 bytes
        text: async () => {
          textReadCalled = true;
          return 'dummy';
        },
      };

      const success = await controller.importFile(file);
      // Critical check: read into memory was REFUSED before reading
      expect(textReadCalled).toBe(false);
      expect(success).toBe(false);
      expect(controller.getState().status).toBe('error');
      expect(controller.getState().error).toContain('exceeds the 10 MiB limit');
      expect(controller.getState().error).toContain('Reading refused');
    });

    it('preserves last good session when an over-limit file import is attempted', async () => {
      const controller = new ImportController();
      await controller.loadCleanDemo();
      const goodSession = controller.getState().currentSession;
      expect(goodSession).not.toBeNull();

      const overFile: ImportableFile = {
        name: 'too-big.har',
        size: RULE_THRESHOLDS.MAX_FILE_BYTES + 500,
        text: async () => 'content',
      };

      const success = await controller.importFile(overFile);
      expect(success).toBe(false);
      // Last-good session is preserved intact
      expect(controller.getState().currentSession).toBe(goodSession);
      expect(controller.getState().sourceKind).toBe('bundled-clean-demo');
    });
  });

  describe('Raw Entry Limits (2,000 maximum entries)', () => {
    it('accepts and normalizes exactly 2,000 entries (boundary ceiling)', () => {
      const har2000 = generateDeterministicHar({ entryCount: 2000 });
      expect(har2000.log.entries).toHaveLength(RULE_THRESHOLDS.MAX_RAW_ENTRIES);

      const result = parseHarData(har2000);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.session.requests).toHaveLength(2000);
      expect(result.session.stats.totalRawEntries).toBe(2000);
      expect(result.session.stats.acceptedEntries).toBe(2000);
      expect(result.session.stats.skippedEntries).toBe(0);
    });

    it('rejects 2,001 entries before expensive normalization with actionable message', () => {
      const har2001 = generateDeterministicHar({ entryCount: 2001 });
      expect(har2001.log.entries).toHaveLength(2001);

      const result = parseHarData(har2001);
      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toContain('Recording contains 2,001 entries');
      expect(result.error).toContain('exceeding the maximum limit of 2,000 raw entries');
      expect(result.error).toContain('Please export a smaller recording');
    });
  });

  describe('Adversarial Strings, URLs & Missing Data Handling', () => {
    const adversarialHar = {
      log: {
        version: '1.2',
        creator: { name: 'HAR Inspector Adversarial Test', version: '1.0' },
        pages: [],
        entries: [
          // Entry 0: XSS in URL query, path, and method
          {
            startedDateTime: '2026-10-23T14:00:00.000Z',
            time: 50,
            request: {
              method: 'GET',
              url: 'https://security.example.com/search?q=<script>alert("XSS")</script>&param=safe#heading-hash',
              httpVersion: 'HTTP/1.1',
              headers: [
                { name: 'X-Injected-Header', value: '<img src=x onerror=alert(1)>' },
                { name: 'Authorization', value: 'Bearer super-secret-token' },
              ],
              cookies: [{ name: 'auth_cookie', value: 'secret-cookie-value' }],
              queryString: [{ name: 'q', value: '<script>alert("XSS")</script>' }],
              headersSize: 100,
              bodySize: 0,
            },
            response: {
              status: 200,
              statusText: '<script>alert("status")</script>',
              httpVersion: 'HTTP/1.1',
              headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
              cookies: [],
              content: { size: 100, mimeType: 'text/html' },
              redirectURL: '',
              headersSize: 80,
              bodySize: 100,
            },
            cache: {},
            timings: { send: 5, wait: 35, receive: 10 },
          },
          // Entry 1: Credentials in URL (username:password)
          {
            startedDateTime: '2026-10-23T14:00:01.000Z',
            time: 120,
            request: {
              method: 'POST',
              url: 'https://admin:superSecretPass123!@api.example.com/v1/auth/login?tenant=alpha#token',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              queryString: [],
              headersSize: 50,
              bodySize: 64,
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              content: { size: 64, mimeType: 'application/json' },
              redirectURL: '',
              headersSize: 50,
              bodySize: 64,
            },
            cache: {},
            timings: { send: 10, wait: 100, receive: 10 },
          },
          // Entry 2: IPv6 literal URL with custom port
          {
            startedDateTime: '2026-10-23T14:00:02.000Z',
            time: 40,
            request: {
              method: 'GET',
              url: 'http://[::1]:8080/metrics/cluster?filter=node#anchor',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              queryString: [],
              headersSize: 40,
              bodySize: 0,
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              content: { size: 500, mimeType: 'text/plain' },
              redirectURL: '',
              headersSize: 40,
              bodySize: 500,
            },
            cache: {},
            timings: { send: 5, wait: 30, receive: 5 },
          },
          // Entry 3: Percent-encoded unicode characters in URL
          {
            startedDateTime: '2026-10-23T14:00:03.000Z',
            time: 85,
            request: {
              method: 'GET',
              url: 'https://cdn.example.com/assets/%E2%9C%A8%20sparkles%20%F0%9F%9A%80?v=1.0',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              queryString: [],
              headersSize: 40,
              bodySize: 0,
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              content: { size: 12000, mimeType: 'image/png' },
              redirectURL: '',
              headersSize: 40,
              bodySize: 12000,
            },
            cache: {},
            timings: { send: 5, wait: 60, receive: 20 },
          },
          // Entry 4: Missing all optional timings, status 0, negative duration & size
          {
            startedDateTime: '2026-10-23T14:00:04.000Z',
            time: -1, // Unknown duration
            request: {
              method: 'GET',
              url: 'https://api.example.com/v1/aborted-connection',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              queryString: [],
              headersSize: 0,
              bodySize: 0,
            },
            response: {
              status: 0, // No HTTP status
              statusText: '',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              content: { size: -1, mimeType: '' },
              redirectURL: '',
              headersSize: 0,
              bodySize: -1, // Unknown body size
            },
            cache: {},
            timings: {}, // Missing all phase keys
          },
          // Entry 5: Extremely long text (5,000 char path)
          {
            startedDateTime: '2026-10-23T14:00:05.000Z',
            time: 150,
            request: {
              method: 'GET',
              url: `https://api.example.com/v1/long-path/${'a'.repeat(4000)}?key=${'b'.repeat(1000)}`,
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              queryString: [],
              headersSize: 5200,
              bodySize: 0,
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              content: { size: 10, mimeType: 'application/json' },
              redirectURL: '',
              headersSize: 50,
              bodySize: 10,
            },
            cache: {},
            timings: { send: 10, wait: 130, receive: 10 },
          },
          // Entry 6: Mixed malformed entry (invalid non-HTTP protocol)
          {
            startedDateTime: '2026-10-23T14:00:06.000Z',
            time: 20,
            request: {
              method: 'GET',
              url: 'file:///etc/passwd',
            },
            response: { status: 200 },
          },
          // Entry 7: Mixed malformed entry (invalid timezone-less date)
          {
            startedDateTime: '2026-10-23 14:00:07', // No timezone
            time: 20,
            request: {
              method: 'GET',
              url: 'https://api.example.com/test',
            },
            response: { status: 200 },
          },
        ],
      },
    };

    it('sanitizes HTML/script injections in URLs and never retains sensitive query values', () => {
      const result = parseHarData(adversarialHar);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const requests = result.session.requests;
      // Entry 0: search with XSS query
      const req0 = requests[0];
      expect(req0.displayUrl).toBe('https://security.example.com/search?query_omitted');
      expect(req0.displayUrl).not.toContain('<script>');
      expect(req0.displayUrl).not.toContain('alert');
      expect(req0.displayUrl).not.toContain('super-secret-token');

      // Assert normalized request does NOT contain header or cookie objects
      const record = req0 as unknown as Record<string, unknown>;
      expect(record.headers).toBeUndefined();
      expect(record.cookies).toBeUndefined();
      expect(record.queryString).toBeUndefined();
    });

    it('strips credentials (user:password) from displayUrl and grouping key', () => {
      const result = parseHarData(adversarialHar);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const req1 = result.session.requests[1];
      expect(req1.displayUrl).toBe('https://api.example.com/v1/auth/login?query_omitted');
      expect(req1.displayUrl).not.toContain('admin');
      expect(req1.displayUrl).not.toContain('superSecretPass123!');
      expect(req1.origin).toBe('https://api.example.com');
      expect(req1.hostname).toBe('api.example.com');
    });

    it('handles IPv6 literal hostnames and custom ports safely', () => {
      const result = parseHarData(adversarialHar);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const req2 = result.session.requests[2];
      expect(req2.origin).toBe('http://[::1]:8080');
      expect(req2.hostname).toBe('[::1]');
      expect(req2.displayUrl).toBe('http://[::1]:8080/metrics/cluster?query_omitted');
    });

    it('handles percent-encoded unicode paths safely without unescaped corruption', () => {
      const result = parseHarData(adversarialHar);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const req3 = result.session.requests[3];
      expect(req3.displayUrl).toContain('/assets/%E2%9C%A8');
      expect(req3.displayUrl).toContain('?query_omitted');
    });

    it('handles absent optional data, negative values, and status 0', () => {
      const result = parseHarData(adversarialHar);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const req4 = result.session.requests[4];
      expect(req4.status).toBe(0);
      expect(req4.durationMs).toBeNull();
      expect(req4.bodyBytes).toBeNull();
      expect(req4.timings).toBeNull();
      expect(req4.warnings).toHaveLength(2); // UNKNOWN_DURATION and UNKNOWN_BODY_SIZE

      // Diagnostics should generate informational finding for status 0
      const findings = evaluateDiagnostics([req4]);
      const status0Finding = findings.find((f) => f.ruleId === 'no-http-status');
      expect(status0Finding).toBeDefined();
      expect(status0Finding?.observationLevel).toBe('info');
    });

    it('handles extremely long text without crashing or hanging', () => {
      const result = parseHarData(adversarialHar);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const req5 = result.session.requests[5];
      expect(req5.displayUrl.length).toBeGreaterThan(4000);
      expect(req5.displayUrl).toContain('?query_omitted');
      expect(req5.durationMs).toBe(150);
    });

    it('records skipped entries count and session warning for mixed malformed entries', () => {
      const result = parseHarData(adversarialHar);
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Entries 6 (file:///) and 7 (invalid date format) are skipped
      expect(result.session.stats.totalRawEntries).toBe(8);
      expect(result.session.stats.acceptedEntries).toBe(6);
      expect(result.session.stats.skippedEntries).toBe(2);

      const skippedWarning = result.session.warnings.find((w) => w.code === 'SKIPPED_ENTRIES');
      expect(skippedWarning).toBeDefined();
      expect(skippedWarning?.affectedCount).toBe(2);
      expect(skippedWarning?.message).toContain('Skipped 2 entry/entries');
    });
  });

  describe('Performance targets (<= 2s import, <= 200ms filter)', () => {
    it('normalizes 2,000 entries well within the 2,000 ms target', () => {
      const har2000 = generateDeterministicHar({ entryCount: 2000 });

      const tStart = performance.now();
      const result = parseHarData(har2000);
      const tElapsed = performance.now() - tStart;

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.session.requests).toHaveLength(2000);
      // Validation target: <= 2,000 ms
      expect(tElapsed).toBeLessThan(2000);
      console.log(`[Performance Benchmark] 2,000-entry parse & normalization elapsed: ${tElapsed.toFixed(2)} ms`);
    });

    it('evaluates diagnostics for 2,000 requests rapidly', () => {
      const har2000 = generateDeterministicHar({ entryCount: 2000 });
      const parseResult = parseHarData(har2000);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;

      const tStart = performance.now();
      const findings = evaluateDiagnostics(parseResult.session.requests);
      const tElapsed = performance.now() - tStart;

      expect(findings.length).toBeGreaterThan(0);
      expect(tElapsed).toBeLessThan(500);
      console.log(`[Performance Benchmark] 2,000-entry diagnostics evaluation elapsed: ${tElapsed.toFixed(2)} ms (found ${findings.length} findings)`);
    });

    it('filters and sorts 2,000 requests well within the 200 ms target', () => {
      const har2000 = generateDeterministicHar({ entryCount: 2000 });
      const parseResult = parseHarData(har2000);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;

      const requests = parseResult.session.requests;

      // Test 1: Search query filter + sort
      const tStart1 = performance.now();
      const filtered1 = filterRequests(requests, {
        searchQuery: 'reports',
        selectedDomain: 'all',
        statusGroup: 'all',
      });
      const sorted1 = sortRequests(filtered1, { field: 'durationMs', direction: 'desc' });
      const tElapsed1 = performance.now() - tStart1;

      expect(sorted1.length).toBeGreaterThan(0);
      expect(tElapsed1).toBeLessThan(200);

      // Test 2: Combined domain + status group filter + sort
      const tStart2 = performance.now();
      const filtered2 = filterRequests(requests, {
        searchQuery: '',
        selectedDomain: 'api.example.com',
        statusGroup: '2xx',
      });
      const sorted2 = sortRequests(filtered2, { field: 'startOffsetMs', direction: 'asc' });
      const tElapsed2 = performance.now() - tStart2;

      expect(sorted2.length).toBeGreaterThan(0);
      expect(tElapsed2).toBeLessThan(200);

      console.log(`[Performance Benchmark] 2,000-entry filter + sort elapsed: Query Filter: ${tElapsed1.toFixed(2)} ms, Domain+Status Filter: ${tElapsed2.toFixed(2)} ms`);
    });
  });

  describe('Privacy & Guardrail Invariants', () => {
    it('guarantees normalized session retains zero raw query values or auth credentials', () => {
      const har2000 = generateDeterministicHar({ entryCount: 2000 });

      const result = parseHarData(har2000);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const serialized = JSON.stringify(result.session);
      // In the generator we put these secrets:
      expect(serialized).not.toContain('mock-secret-token-12345');
      expect(serialized).not.toContain('mock_session_cookie_secret');
      expect(serialized).not.toContain('Bearer ');
      expect(serialized).not.toContain('param=value_'); // raw query string must not leak into serialized state
    });

    it('guarantees transient grouping map is reset and ephemeral keys are not leaked', () => {
      const har2000 = generateDeterministicHar({ entryCount: 2000 });

      const result = parseHarData(har2000);
      expect(result.success).toBe(true);
      if (!result.success) return;

      for (const req of result.session.requests) {
        expect(req.urlGroupId).toMatch(/^group-\d+$/);
        // Ensure no full raw URL or query is in urlGroupId
        expect(req.urlGroupId).not.toContain('http');
        expect(req.urlGroupId).not.toContain('?');
      }
    });
  });
});

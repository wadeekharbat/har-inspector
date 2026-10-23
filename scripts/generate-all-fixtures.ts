import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDeterministicHar } from '../src/fixtures/generate-scale-fixture.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testFilesDir = path.resolve(__dirname, '..', 'test-files');

if (!fs.existsSync(testFilesDir)) {
  fs.mkdirSync(testFilesDir, { recursive: true });
}

// Import scenarios reuse the bundled synthetic recording.
const cleanFixture = path.resolve(__dirname, '..', 'src', 'fixtures', 'clean-session.har.json');
fs.copyFileSync(cleanFixture, path.join(testFilesDir, 'clean-session.har'));
fs.copyFileSync(cleanFixture, path.join(testFilesDir, 'Broken Checkout.har'));
fs.writeFileSync(path.join(testFilesDir, '2-malformed-secret.har'), 'SECRET_TOKEN_XYZ_DO_NOT_LEAK is invalid JSON syntax!');

// 1. Generate 2,000 entries fixture (exact maximum allowed entries)
console.log('Generating 2,000 entries fixture...');
const har2000 = generateDeterministicHar({ entryCount: 2000 });
const har2000Path = path.join(testFilesDir, '2000-entries.har');
fs.writeFileSync(har2000Path, JSON.stringify(har2000, null, 2), 'utf-8');
const stat2000 = fs.statSync(har2000Path);
console.log(`✓ Created ${har2000Path} (${stat2000.size.toLocaleString()} bytes, 2,000 entries)`);

// 2. Generate 2,001 entries fixture (exceeding maximum 2,000 limit by 1)
console.log('Generating 2,001 entries fixture...');
const har2001 = generateDeterministicHar({ entryCount: 2001 });
const har2001Path = path.join(testFilesDir, '2001-entries.har');
fs.writeFileSync(har2001Path, JSON.stringify(har2001, null, 2), 'utf-8');
const stat2001 = fs.statSync(har2001Path);
console.log(`✓ Created ${har2001Path} (${stat2001.size.toLocaleString()} bytes, 2,001 entries)`);

// 3. Generate adversarial cases fixture
console.log('Generating adversarial cases fixture...');
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

const adversarialPath = path.join(testFilesDir, 'adversarial-cases.har');
fs.writeFileSync(adversarialPath, JSON.stringify(adversarialHar, null, 2), 'utf-8');
console.log(`✓ Created ${adversarialPath}`);

// 4. File limit fixtures (exact 10,485,760 bytes, and 10,485,761 bytes)
console.log('Generating file limit boundary fixtures...');
const MAX_BYTES = 10485760;
// We construct a valid JSON HAR structure with padding comment/whitespace to reach exact byte counts
const baseHarStructure = {
  log: {
    version: '1.2',
    creator: { name: 'HAR Inspector Limit Test', version: '1.0' },
    pages: [],
    entries: [
      {
        startedDateTime: '2026-10-23T15:00:00.000Z',
        time: 10,
        request: { method: 'GET', url: 'https://api.example.com/limit-test' },
        response: { status: 200, bodySize: 100 },
        timings: { send: 1, wait: 8, receive: 1 },
      },
    ],
  },
};

const baseJson = JSON.stringify(baseHarStructure);
// Use log.comment padding to produce exact byte boundaries.

// Calculate exact padding needed
const exactFileTarget = MAX_BYTES; // 10,485,760 bytes
const overFileTarget = MAX_BYTES + 1; // 10,485,761 bytes

function createPaddedHar(targetSize: number): Buffer {
  // Header part
  const header = '{"log":{"version":"1.2","creator":{"name":"HAR Inspector Limit Test","version":"1.0"},"entries":[{"startedDateTime":"2026-10-23T15:00:00.000Z","time":10,"request":{"method":"GET","url":"https://api.example.com/limit-test"},"response":{"status":200,"bodySize":100},"timings":{"send":1,"wait":8,"receive":1}}],"comment":"';
  const footer = '"}}';
  const paddingLen = targetSize - (header.length + footer.length);
  const padding = 'x'.repeat(paddingLen);
  const fullStr = header + padding + footer;
  return Buffer.from(fullStr, 'utf-8');
}

const exactBuf = createPaddedHar(exactFileTarget);
const exactPath = path.join(testFilesDir, 'file-limit-exact.har');
fs.writeFileSync(exactPath, exactBuf);
console.log(`✓ Created ${exactPath} (exact size: ${fs.statSync(exactPath).size.toLocaleString()} bytes)`);

const overBuf = createPaddedHar(overFileTarget);
const overPath = path.join(testFilesDir, 'file-limit-over.har');
fs.writeFileSync(overPath, overBuf);
console.log(`✓ Created ${overPath} (over size: ${fs.statSync(overPath).size.toLocaleString()} bytes)`);

console.log('All test fixtures generated successfully!');

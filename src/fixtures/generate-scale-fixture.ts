/**
 * Deterministic generator for scale and performance test fixtures.
 * Generates valid HAR 1.2 recordings with reproducible entries and timings.
 */

export interface GeneratorOptions {
  entryCount: number;
  baseTimestamp?: string;
  includeRepeatedGetGroup?: boolean;
  includeLongRequests?: boolean;
  includeLargeBodies?: boolean;
  includeHttpErrors?: boolean;
}

export function generateDeterministicHar(options: GeneratorOptions): {
  log: {
    version: string;
    creator: { name: string; version: string };
    pages: Array<{ id: string; title: string; startedDateTime: string }>;
    entries: Array<Record<string, unknown>>;
  };
} {
  const {
    entryCount,
    baseTimestamp = '2026-10-23T12:00:00.000Z',
    includeRepeatedGetGroup = true,
    includeLongRequests = true,
    includeLargeBodies = true,
    includeHttpErrors = true,
  } = options;

  const baseMs = Date.parse(baseTimestamp);
  const entries: Array<Record<string, unknown>> = [];

  const hostnames = [
    'api.example.com',
    'cdn.example.com',
    'auth.example.com',
    'checkout.example.com',
    'static.example.com',
  ];

  const mimeTypes = [
    'application/json',
    'text/html; charset=utf-8',
    'application/javascript',
    'image/png',
    'text/css',
  ];

  for (let i = 0; i < entryCount; i++) {
    // Spread requests over time (e.g. 50ms intervals)
    let offsetMs = i * 50;
    const hostname = hostnames[i % hostnames.length];
    let method = 'GET';
    let url = `https://${hostname}/v1/resource/${i}?param=value_${i}`;
    let status = 200;
    let durationMs = 45 + (i % 200);
    let bodySize = 1024 + ((i * 350) % 50000);
    let waitMs = Math.round(durationMs * 0.7);

    // Controlled rule triggers for realistic analysis:
    // Repeated GET group around index 100-104
    if (includeRepeatedGetGroup && i >= 100 && i <= 103) {
      method = 'GET';
      url = 'https://api.example.com/v1/telemetry/heartbeat?client=web';
      offsetMs = 100 * 50 + (i - 100) * 200; // 200ms intervals (well within 2000ms window)
      status = 200;
      durationMs = 30;
      bodySize = 256;
      waitMs = 20;
    }
    // Long requests (> 1,000ms) at specific intervals
    else if (includeLongRequests && i % 250 === 0 && i > 0) {
      durationMs = 1250 + (i % 300);
      waitMs = 1200;
      url = `https://api.example.com/v1/reports/export_${i}?format=csv`;
    }
    // Large bodies (> 1 MiB) at specific intervals
    else if (includeLargeBodies && i % 350 === 0 && i > 0) {
      bodySize = 1048576 + 50000 + i * 100; // > 1 MiB
      url = `https://cdn.example.com/bundles/heavy-asset-${i}.dat`;
    }
    // HTTP errors (4xx / 5xx) at specific intervals
    else if (includeHttpErrors && i % 150 === 0 && i > 0) {
      status = i % 300 === 0 ? 500 : 404;
      url = `https://api.example.com/v1/missing-endpoint-${i}`;
      bodySize = 512;
    } else if (i % 8 === 0) {
      method = 'POST';
      url = `https://checkout.example.com/v1/cart/item-${i}`;
    }

    const entryTime = new Date(baseMs + offsetMs).toISOString();

    const blocked = 2;
    const dns = i % 10 === 0 ? 15 : 0;
    const connect = i % 10 === 0 ? 25 : 0;
    const send = 5;
    const wait = Math.max(1, waitMs);
    const receive = Math.max(1, durationMs - (blocked + dns + connect + send + wait));
    const totalTime = blocked + dns + connect + send + wait + receive;

    entries.push({
      startedDateTime: entryTime,
      time: totalTime,
      request: {
        method,
        url,
        httpVersion: 'HTTP/1.1',
        headers: [
          { name: 'Host', value: hostname },
          { name: 'User-Agent', value: 'HAR InspectorBenchmark/1.0' },
          { name: 'Authorization', value: 'Bearer mock-secret-token-12345' },
        ],
        cookies: [{ name: 'session_id', value: 'mock_session_cookie_secret' }],
        queryString: [{ name: 'param', value: `value_${i}` }],
        headersSize: 250,
        bodySize: method === 'POST' ? 128 : 0,
      },
      response: {
        status,
        statusText: status === 200 ? 'OK' : status === 500 ? 'Internal Server Error' : 'Not Found',
        httpVersion: 'HTTP/1.1',
        headers: [
          { name: 'Content-Type', value: mimeTypes[i % mimeTypes.length] },
          { name: 'Content-Length', value: String(bodySize) },
        ],
        cookies: [],
        content: {
          size: bodySize,
          mimeType: mimeTypes[i % mimeTypes.length],
        },
        redirectURL: '',
        headersSize: 180,
        bodySize,
      },
      cache: {},
      timings: {
        blocked,
        dns,
        connect,
        send,
        wait,
        receive,
        ssl: connect > 0 ? 15 : -1,
      },
    });
  }

  return {
    log: {
      version: '1.2',
      creator: {
        name: 'HAR Inspector Benchmark Generator',
        version: '1.0',
      },
      pages: [
        {
          id: 'page-1',
          title: 'Benchmark Page',
          startedDateTime: baseTimestamp,
        },
      ],
      entries,
    },
  };
}

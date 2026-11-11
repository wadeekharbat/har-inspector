import {
  DiagnosticFinding,
  FindingRuleId,
  NormalizedRequest,
  RULE_THRESHOLDS,
  DIAGNOSTIC_THRESHOLDS,
  ObservationLevel,
} from './types';

export { RULE_THRESHOLDS, DIAGNOSTIC_THRESHOLDS };

export interface DiagnosticsSummary {
  totalFindings: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  uniqueAffectedRequestCount: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function evaluateHttpErrorRule(
  requests: readonly NormalizedRequest[]
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const req of requests) {
    if (
      req.status !== null &&
      req.status >= RULE_THRESHOLDS.HTTP_ERROR_MIN_STATUS &&
      req.status <= RULE_THRESHOLDS.HTTP_ERROR_MAX_STATUS
    ) {
      const isServerError = req.status >= 500;
      const observationLevel: ObservationLevel = isServerError ? 'error' : 'warning';
      const categoryLabel = isServerError ? '5xx Server Error' : '4xx Client Error';

      findings.push({
        id: `finding-http-error-${req.id}`,
        ruleId: 'http-error',
        label: `HTTP ${req.status} Error Response: ${req.method} ${req.displayUrl}`,
        observationLevel,
        requestIds: [req.id],
        observedValues: {
          status: req.status,
          method: req.method,
          displayUrl: req.displayUrl,
        },
        threshold: `${RULE_THRESHOLDS.HTTP_ERROR_MIN_STATUS}–${RULE_THRESHOLDS.HTTP_ERROR_MAX_STATUS}`,
        explanation: `The recording captured an HTTP response with recorded status code ${req.status} (${categoryLabel}).`,
        nextInvestigation:
          'Inspect server response payload, application server logs, and upstream service availability. Check whether headers, credentials, or parameters contributed to the response.',
        limitations:
          'An HTTP error response indicates the server returned an error status code, but does not prove whether the failure was user-facing, transient, or whether preceding network requests contributed to the failure.',
      });
    }
  }

  return findings;
}

// Status 0 comes from the exporter. Null is handled as a data-quality issue.
export function evaluateNoHttpStatusRule(
  requests: readonly NormalizedRequest[]
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const req of requests) {
    if (req.status === 0) {
      findings.push({
        id: `finding-no-http-status-${req.id}`,
        ruleId: 'no-http-status',
        label: `Missing Recorded HTTP Response Status: ${req.method} ${req.displayUrl}`,
        observationLevel: 'info',
        requestIds: [req.id],
        observedValues: {
          status: 0,
          method: req.method,
          displayUrl: req.displayUrl,
        },
        threshold: 'status = 0',
        explanation:
          'The recording exporter recorded a status code of 0, indicating no HTTP response status was captured for this request.',
        nextInvestigation:
          'Check browser developer console for CORS restrictions, DNS failures, or connection aborts. Check whether the recording exporter dropped connection completion metadata.',
        limitations:
          'A status code of 0 indicates missing response status in the recording, not conclusive proof of a network transport failure, connection reset, or client-side abort.',
      });
    }
  }

  return findings;
}

export function evaluateLongRequestRule(
  requests: readonly NormalizedRequest[]
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const req of requests) {
    if (req.durationMs !== null && req.durationMs >= RULE_THRESHOLDS.LONG_REQUEST_MS) {
      findings.push({
        id: `finding-long-request-${req.id}`,
        ruleId: 'long-request',
        label: `Long Request Duration (${req.durationMs.toLocaleString()} ms): ${req.method} ${req.displayUrl}`,
        observationLevel: 'warning',
        requestIds: [req.id],
        observedValues: {
          durationMs: req.durationMs,
          method: req.method,
          displayUrl: req.displayUrl,
        },
        threshold: `${RULE_THRESHOLDS.LONG_REQUEST_MS} ms`,
        explanation: `Total recorded elapsed duration was ${req.durationMs.toLocaleString()} ms, meeting or exceeding the diagnostic investigation threshold of ${RULE_THRESHOLDS.LONG_REQUEST_MS.toLocaleString()} ms.`,
        nextInvestigation:
          'Examine recorded timing breakdown (wait time vs download time), backend database or external service latency, and evaluate whether payload caching or query optimization is applicable.',
        limitations:
          'Long request duration is an investigation heuristic, not proof of user-visible delay, UI thread blocking, or backend slowness (e.g. streaming responses, SSE, or long-polling naturally have high elapsed durations).',
      });
    }
  }

  return findings;
}

export function evaluateLargeBodyRule(
  requests: readonly NormalizedRequest[]
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const req of requests) {
    if (req.bodyBytes !== null && req.bodyBytes >= RULE_THRESHOLDS.LARGE_BODY_BYTES) {
      findings.push({
        id: `finding-large-body-${req.id}`,
        ruleId: 'large-body',
        label: `Large Recorded Response Body (${formatBytes(req.bodyBytes)}): ${req.method} ${req.displayUrl}`,
        observationLevel: 'warning',
        requestIds: [req.id],
        observedValues: {
          bodyBytes: req.bodyBytes,
          formattedSize: formatBytes(req.bodyBytes),
          method: req.method,
          displayUrl: req.displayUrl,
        },
        threshold: `${RULE_THRESHOLDS.LARGE_BODY_BYTES.toLocaleString()} bytes (1 MiB)`,
        explanation: `Recorded response bodySize was ${req.bodyBytes.toLocaleString()} bytes (${formatBytes(req.bodyBytes)}), meeting or exceeding the 1 MiB (1,048,576 bytes) threshold.`,
        nextInvestigation:
          'Inspect content compression headers (Content-Encoding: gzip/br), image dimensions/formats, pagination chunk sizes, or asset bundling.',
        limitations:
          'Recorded bodySize reflects exporter-reported response bytes, which may differ from over-the-wire transfer size due to caching, chunking, or TLS overhead. It does not prove browser rendering impact or network bandwidth saturation.',
      });
    }
  }

  return findings;
}

// Report one finding per URL group. Include each request that falls in a qualifying window.
export function evaluateRepeatedGetRule(
  requests: readonly NormalizedRequest[]
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  const groups = new Map<string, NormalizedRequest[]>();
  for (const req of requests) {
    if (req.method === 'GET') {
      const existing = groups.get(req.urlGroupId);
      if (existing) {
        existing.push(req);
      } else {
        groups.set(req.urlGroupId, [req]);
      }
    }
  }

  for (const [groupId, groupRequests] of groups.entries()) {
    if (groupRequests.length < RULE_THRESHOLDS.REPEATED_GET_MIN_COUNT) {
      continue;
    }

    const sorted = [...groupRequests].sort((a, b) => {
      if (a.startOffsetMs !== b.startOffsetMs) {
        return a.startOffsetMs - b.startOffsetMs;
      }
      return a.sourceIndex - b.sourceIndex;
    });

    const qualifyingIdsSet = new Set<string>();
    let qualifyingWindowsCount = 0;

    for (let i = 0; i <= sorted.length - RULE_THRESHOLDS.REPEATED_GET_MIN_COUNT; i++) {
      const first = sorted[i];
      const third = sorted[i + (RULE_THRESHOLDS.REPEATED_GET_MIN_COUNT - 1)];
      const windowSpan = third.startOffsetMs - first.startOffsetMs;

      if (windowSpan <= RULE_THRESHOLDS.REPEATED_GET_WINDOW_MS) {
        qualifyingWindowsCount++;
        qualifyingIdsSet.add(sorted[i].id);
        qualifyingIdsSet.add(sorted[i + 1].id);
        qualifyingIdsSet.add(sorted[i + 2].id);
      }
    }

    if (qualifyingIdsSet.size > 0) {
      const matchingRequests = sorted.filter((r) => qualifyingIdsSet.has(r.id));
      matchingRequests.sort((a, b) => a.sourceIndex - b.sourceIndex);
      const requestIds = matchingRequests.map((r) => r.id);
      const sampleReq = matchingRequests[0];

      findings.push({
        id: `finding-repeated-get-${groupId}`,
        ruleId: 'repeated-get',
        label: `Repeated GET Requests (${requestIds.length} calls): ${sampleReq.displayUrl}`,
        observationLevel: 'warning',
        requestIds,
        observedValues: {
          qualifyingRequestCount: requestIds.length,
          totalInGroup: groupRequests.length,
          qualifyingWindowsCount,
          displayUrl: sampleReq.displayUrl,
        },
        threshold: `At least ${RULE_THRESHOLDS.REPEATED_GET_MIN_COUNT} GET requests within a ${RULE_THRESHOLDS.REPEATED_GET_WINDOW_MS.toLocaleString()} ms window (inclusive)`,
        explanation: `Detected ${requestIds.length} GET requests to the same URL endpoint with at least 3 consecutive starts occurring within a 2,000 ms window.`,
        nextInvestigation:
          'Review client-side polling loops, retry strategies, event handler debouncing, or React component re-rendering triggers. Verify whether HTTP caching (ETag / Cache-Control) is utilized.',
        limitations:
          'Repeated requests are flagged for investigation, not redundancy; polling, pagination prefetching, or retry loops may be deliberate and necessary application behaviors.',
      });
    }
  }

  return findings;
}

const RULE_CATEGORY_ORDER: Record<FindingRuleId, number> = {
  'http-error': 1,
  'no-http-status': 2,
  'repeated-get': 3,
  'long-request': 4,
  'large-body': 5,
};

// Sort by category and original request order so findings stay stable across runs.
export function evaluateDiagnostics(
  requests: readonly NormalizedRequest[]
): DiagnosticFinding[] {
  const httpErrorFindings = evaluateHttpErrorRule(requests);
  const noHttpStatusFindings = evaluateNoHttpStatusRule(requests);
  const longRequestFindings = evaluateLongRequestRule(requests);
  const largeBodyFindings = evaluateLargeBodyRule(requests);
  const repeatedGetFindings = evaluateRepeatedGetRule(requests);

  const allFindings = [
    ...httpErrorFindings,
    ...noHttpStatusFindings,
    ...longRequestFindings,
    ...largeBodyFindings,
    ...repeatedGetFindings,
  ];

  const requestIndexMap = new Map<string, number>();
  for (const req of requests) {
    requestIndexMap.set(req.id, req.sourceIndex);
  }

  return allFindings.sort((a, b) => {
    const catA = RULE_CATEGORY_ORDER[a.ruleId] ?? 99;
    const catB = RULE_CATEGORY_ORDER[b.ruleId] ?? 99;
    if (catA !== catB) {
      return catA - catB;
    }

    const minIndexA = Math.min(
      ...a.requestIds.map((id) => requestIndexMap.get(id) ?? Number.MAX_SAFE_INTEGER)
    );
    const minIndexB = Math.min(
      ...b.requestIds.map((id) => requestIndexMap.get(id) ?? Number.MAX_SAFE_INTEGER)
    );
    if (minIndexA !== minIndexB) {
      return minIndexA - minIndexB;
    }

    return a.id.localeCompare(b.id);
  });
}

// A request can match several rules. Count it once in the summary.
export function computeDiagnosticsSummary(
  findings: readonly DiagnosticFinding[],
  _totalRequests: number
): DiagnosticsSummary {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  const uniqueRequestIds = new Set<string>();

  for (const f of findings) {
    if (f.observationLevel === 'error') {
      errorCount++;
    } else if (f.observationLevel === 'warning') {
      warningCount++;
    } else if (f.observationLevel === 'info') {
      infoCount++;
    }

    for (const reqId of f.requestIds) {
      uniqueRequestIds.add(reqId);
    }
  }

  return {
    totalFindings: findings.length,
    errorCount,
    warningCount,
    infoCount,
    uniqueAffectedRequestCount: uniqueRequestIds.size,
  };
}

export function filterFindingsByLevel(
  findings: readonly DiagnosticFinding[],
  levelFilter: 'all' | ObservationLevel
): DiagnosticFinding[] {
  if (levelFilter === 'all') {
    return [...findings];
  }
  return findings.filter((f) => f.observationLevel === levelFilter);
}

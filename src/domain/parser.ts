import {
  type NormalizedRequest,
  type NormalizedSession,
  type SessionTimeline,
  type SessionStats,
  type SessionWarning,
  type TimingPhases,
  type RequestWarning,
  RULE_THRESHOLDS,
} from './types';

export type ParseResult =
  | { success: true; session: NormalizedSession }
  | { success: false; error: string };

// Require a timezone so parsing cannot depend on the machine's local timezone.
function isValidIsoWithTimezone(dateTimeStr: string): boolean {
  if (typeof dateTimeStr !== 'string') return false;
  const trimmed = dateTimeStr.trim();
  if (trimmed === '') return false;

  // Regex requires YYYY-MM-DD[T ]HH:MM(:SS(.sss)?) followed by explicit timezone indicator:
  // Z, or [+-]HH:MM, [+-]HHMM, [+-]HH
  const isoWithTimezoneRegex = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
  if (!isoWithTimezoneRegex.test(trimmed)) {
    return false;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && !Number.isNaN(parsed);
}

// Keep only the origin and path for display, with a marker when a query was present.
function sanitizeDisplayUrl(parsedUrl: URL, originalUrlStr: string): string {
  const originAndPath = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const beforeHash = originalUrlStr.split('#')[0] ?? '';
  const hasQuery = Boolean(parsedUrl.search) || beforeHash.includes('?');
  if (hasQuery) {
    return `${originAndPath}?query_omitted`;
  }
  return originAndPath;
}

// Use the query for grouping during parsing without exposing its values in the session.
function createGroupingKey(method: string, parsedUrl: URL): string {
  const cleanUrl = new URL(parsedUrl.toString());
  cleanUrl.username = '';
  cleanUrl.password = '';
  cleanUrl.hash = '';
  return `${method} ${cleanUrl.toString()}`;
}

// SSL is part of connect time. Keep both values for display without adding them together.
function parseTimings(rawTimings: unknown): TimingPhases | null {
  if (!rawTimings || typeof rawTimings !== 'object' || Array.isArray(rawTimings)) {
    return null;
  }

  const t = rawTimings as Record<string, unknown>;
  const phases: TimingPhases = {};
  let hasAnyPhase = false;

  const phaseKeys: Array<keyof TimingPhases> = [
    'blocked',
    'dns',
    'connect',
    'send',
    'wait',
    'receive',
    'ssl',
  ];

  for (const key of phaseKeys) {
    const val = t[key];
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
      phases[key] = val;
      hasAnyPhase = true;
    } else {
      phases[key] = null;
    }
  }

  return hasAnyPhase ? phases : null;
}

export function parseHarData(data: unknown): ParseResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      success: false,
      error: 'Invalid HAR format: root must be a JSON object.',
    };
  }

  const root = data as Record<string, unknown>;

  if (!root.log || typeof root.log !== 'object' || Array.isArray(root.log)) {
    return {
      success: false,
      error: 'Invalid HAR format: missing "log" object.',
    };
  }

  const log = root.log as Record<string, unknown>;

  if (!Array.isArray(log.entries)) {
    return {
      success: false,
      error: 'Invalid HAR format: missing or invalid "log.entries" array.',
    };
  }

  const rawEntries = log.entries;
  const totalRawEntries = rawEntries.length;

  // Enforce 2,000 raw entries limit before expensive normalization
  if (totalRawEntries > RULE_THRESHOLDS.MAX_RAW_ENTRIES) {
    return {
      success: false,
      error: `Recording contains ${totalRawEntries.toLocaleString()} entries, exceeding the maximum limit of ${RULE_THRESHOLDS.MAX_RAW_ENTRIES.toLocaleString()} raw entries. Please export a smaller recording.`,
    };
  }

  const sessionWarnings: SessionWarning[] = [];

  const rawVersion = log.version;
  if (rawVersion !== '1.2') {
    sessionWarnings.push({
      code: 'COMPATIBILITY_VERSION',
      severity: 'warning',
      message: `HAR version "${typeof rawVersion === 'string' ? rawVersion : 'unspecified'}" differs from expected 1.2. Some fields may not be supported.`,
    });
  }

  if (totalRawEntries === 0) {
    const emptyStats: SessionStats = {
      totalRawEntries: 0,
      acceptedEntries: 0,
      skippedEntries: 0,
      knownBodyBytesTotal: 0,
      unknownBodyBytesCount: 0,
      httpErrorCount: 0,
      unknownStatusCount: 0,
    };

    const emptyTimeline: SessionTimeline = {
      originTimestampMs: null,
      totalSpanMs: 0,
    };

    return {
      success: true,
      session: {
        requests: [],
        timeline: emptyTimeline,
        stats: emptyStats,
        warnings: sessionWarnings,
      },
    };
  }

  // Transient map for ephemeral grouping; strictly reset before returning
  const transientGroupMap = new Map<string, string>();

  interface ValidatedEntryIntermediate {
    sourceIndex: number;
    method: string;
    parsedUrl: URL;
    originalUrlStr: string;
    startedDateTime: string;
    timestampMs: number;
    durationMs: number | null;
    status: number | null;
    bodyBytes: number | null;
    mimeType: string | null;
    timings: TimingPhases | null;
    warnings: RequestWarning[];
    urlGroupId: string;
  }

  const intermediateList: ValidatedEntryIntermediate[] = [];
  let skippedEntriesCount = 0;

  for (let i = 0; i < totalRawEntries; i++) {
    const rawEntry = rawEntries[i];
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      skippedEntriesCount++;
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;

    if (typeof entry.startedDateTime !== 'string' || !isValidIsoWithTimezone(entry.startedDateTime)) {
      skippedEntriesCount++;
      continue;
    }
    const startedDateTime = entry.startedDateTime.trim();
    const timestampMs = Date.parse(startedDateTime);

    if (!entry.request || typeof entry.request !== 'object' || Array.isArray(entry.request)) {
      skippedEntriesCount++;
      continue;
    }
    const rawReq = entry.request as Record<string, unknown>;

    if (typeof rawReq.method !== 'string' || rawReq.method.trim() === '') {
      skippedEntriesCount++;
      continue;
    }
    const method = rawReq.method.trim().toUpperCase();

    if (typeof rawReq.url !== 'string' || rawReq.url.trim() === '') {
      skippedEntriesCount++;
      continue;
    }
    const originalUrlStr = rawReq.url.trim();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(originalUrlStr);
    } catch {
      skippedEntriesCount++;
      continue;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      skippedEntriesCount++;
      continue;
    }

    if (!entry.response || typeof entry.response !== 'object' || Array.isArray(entry.response)) {
      skippedEntriesCount++;
      continue;
    }
    const rawRes = entry.response as Record<string, unknown>;

    const requestWarnings: RequestWarning[] = [];

    let durationMs: number | null = null;
    if (typeof entry.time === 'number' && Number.isFinite(entry.time) && entry.time >= 0) {
      durationMs = entry.time;
    } else {
      requestWarnings.push({
        code: 'UNKNOWN_DURATION',
        message: 'Request duration was missing or invalid; recorded as unknown.',
      });
    }

    let status: number | null = null;
    if (
      typeof rawRes.status === 'number' &&
      Number.isInteger(rawRes.status) &&
      rawRes.status >= 0 &&
      rawRes.status <= 599
    ) {
      status = rawRes.status;
    } else {
      requestWarnings.push({
        code: 'INVALID_STATUS',
        message: 'HTTP response status was missing or outside 0-599; coerced to null.',
      });
    }

    let bodyBytes: number | null = null;
    if (
      typeof rawRes.bodySize === 'number' &&
      Number.isFinite(rawRes.bodySize) &&
      rawRes.bodySize >= 0
    ) {
      bodyBytes = rawRes.bodySize;
    } else {
      requestWarnings.push({
        code: 'UNKNOWN_BODY_SIZE',
        message: 'Recorded bodySize was missing or negative; recorded as unknown.',
      });
    }

    let mimeType: string | null = null;
    if (
      rawRes.content &&
      typeof rawRes.content === 'object' &&
      typeof (rawRes.content as Record<string, unknown>).mimeType === 'string'
    ) {
      const rawMime = ((rawRes.content as Record<string, unknown>).mimeType as string).trim();
      if (rawMime.length > 0) {
        mimeType = rawMime;
      }
    }

    const timings = parseTimings(entry.timings);

    // Ephemeral URL Grouping (method + full URL with query, without credentials/fragment)
    const groupingKey = createGroupingKey(method, parsedUrl);
    let groupId = transientGroupMap.get(groupingKey);
    if (!groupId) {
      groupId = `group-${transientGroupMap.size}`;
      transientGroupMap.set(groupingKey, groupId);
    }

    intermediateList.push({
      sourceIndex: i,
      method,
      parsedUrl,
      originalUrlStr,
      startedDateTime,
      timestampMs,
      durationMs,
      status,
      bodyBytes,
      mimeType,
      timings,
      warnings: requestWarnings,
      urlGroupId: groupId,
    });
  }

  // Transient map must be cleared immediately after parsing so raw keys are never retained
  transientGroupMap.clear();

  // If nonempty input has no usable entries, reject it
  if (intermediateList.length === 0) {
    return {
      success: false,
      error: `Recording contains no usable HTTP entries (${totalRawEntries.toLocaleString()} entry/entries skipped due to invalid structure).`,
    };
  }

  const originTimestampMs = Math.min(...intermediateList.map((item) => item.timestampMs));

  const normalizedRequests: NormalizedRequest[] = intermediateList.map((item) => {
    const startOffsetMs = item.timestampMs - originTimestampMs;
    const displayUrl = sanitizeDisplayUrl(item.parsedUrl, item.originalUrlStr);

    return {
      id: `req-${item.sourceIndex}`,
      sourceIndex: item.sourceIndex,
      method: item.method,
      origin: item.parsedUrl.origin,
      hostname: item.parsedUrl.hostname,
      displayUrl,
      startedDateTime: item.startedDateTime,
      startOffsetMs,
      durationMs: item.durationMs,
      status: item.status,
      bodyBytes: item.bodyBytes,
      mimeType: item.mimeType,
      timings: item.timings,
      warnings: item.warnings,
      urlGroupId: item.urlGroupId,
    };
  });

  const extents = normalizedRequests.map((r) => r.startOffsetMs + (r.durationMs ?? 0));
  const totalSpanMs = Math.max(0, ...extents);

  const timeline: SessionTimeline = {
    originTimestampMs,
    totalSpanMs,
  };

  let knownBodyBytesTotal = 0;
  let unknownBodyBytesCount = 0;
  let httpErrorCount = 0;
  let unknownStatusCount = 0;
  let unknownDurationCount = 0;

  for (const r of normalizedRequests) {
    if (r.bodyBytes !== null) {
      knownBodyBytesTotal += r.bodyBytes;
    } else {
      unknownBodyBytesCount++;
    }

    if (r.status !== null) {
      if (
        r.status >= RULE_THRESHOLDS.HTTP_ERROR_MIN_STATUS &&
        r.status <= RULE_THRESHOLDS.HTTP_ERROR_MAX_STATUS
      ) {
        httpErrorCount++;
      }
    } else {
      unknownStatusCount++;
    }

    if (r.durationMs === null) {
      unknownDurationCount++;
    }
  }

  const stats: SessionStats = {
    totalRawEntries,
    acceptedEntries: normalizedRequests.length,
    skippedEntries: skippedEntriesCount,
    knownBodyBytesTotal,
    unknownBodyBytesCount,
    httpErrorCount,
    unknownStatusCount,
  };

  if (skippedEntriesCount > 0) {
    sessionWarnings.push({
      code: 'SKIPPED_ENTRIES',
      severity: 'warning',
      message: `Skipped ${skippedEntriesCount.toLocaleString()} entry/entries due to malformed or unsupported structure.`,
      affectedCount: skippedEntriesCount,
    });
  }

  if (unknownStatusCount > 0) {
    sessionWarnings.push({
      code: 'DATA_QUALITY_STATUS',
      severity: 'info',
      message: `${unknownStatusCount.toLocaleString()} request(s) had missing or invalid HTTP status values (coerced to null).`,
      affectedCount: unknownStatusCount,
    });
  }

  if (unknownDurationCount > 0) {
    sessionWarnings.push({
      code: 'DATA_QUALITY_DURATION',
      severity: 'info',
      message: `${unknownDurationCount.toLocaleString()} request(s) had missing or unrecorded duration values (recorded as unknown).`,
      affectedCount: unknownDurationCount,
    });
  }

  return {
    success: true,
    session: {
      requests: normalizedRequests,
      timeline,
      stats,
      warnings: sessionWarnings,
    },
  };
}

export function parseHarContent(rawContent: string, declaredByteSize?: number): ParseResult {
  // Check declared byte size if provided (e.g. File.size checked before reading)
  if (declaredByteSize !== undefined && declaredByteSize > RULE_THRESHOLDS.MAX_FILE_BYTES) {
    return {
      success: false,
      error: `File size (${declaredByteSize.toLocaleString()} bytes) exceeds the 10 MiB limit (${RULE_THRESHOLDS.MAX_FILE_BYTES.toLocaleString()} bytes).`,
    };
  }

  // Calculate actual UTF-8 byte length if declaredByteSize was not supplied
  const actualByteLength =
    declaredByteSize ??
    (typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(rawContent).length
      : typeof Blob !== 'undefined'
      ? new Blob([rawContent]).size
      : rawContent.length);

  if (actualByteLength > RULE_THRESHOLDS.MAX_FILE_BYTES) {
    return {
      success: false,
      error: `File size (${actualByteLength.toLocaleString()} bytes) exceeds the 10 MiB limit (${RULE_THRESHOLDS.MAX_FILE_BYTES.toLocaleString()} bytes).`,
    };
  }

  let cleanContent = rawContent;
  if (cleanContent.charCodeAt(0) === 0xfeff) {
    cleanContent = cleanContent.slice(1);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleanContent);
  } catch {
    return {
      success: false,
      error: 'Invalid JSON format: file content could not be parsed as valid JSON.',
    };
  }

  return parseHarData(parsedJson);
}

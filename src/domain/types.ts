/**
 * HAR Inspector Core Domain Types & Contracts
 * Types shared by parsing, diagnostics, and the request explorer.
 */

export interface TimingPhases {
  blocked?: number | null;
  dns?: number | null;
  connect?: number | null;
  send?: number | null;
  wait?: number | null;
  receive?: number | null;
  ssl?: number | null;
}

export interface RequestWarning {
  code: string;
  message: string;
}

export interface NormalizedRequest {
  /** Stable synthetic ID derived from source index, e.g. "req-0" */
  id: string;
  /** Original zero-based index in the raw HAR log.entries array */
  sourceIndex: number;
  /** Uppercased, trimmed HTTP method (e.g. "GET", "POST") */
  method: string;
  /** Parsed origin (e.g. "https://checkout.example.com") */
  origin: string;
  /** Parsed hostname (e.g. "checkout.example.com") */
  hostname: string;
  /**
   * Sanitized URL for display: credentials omitted, query values replaced with
   * "?query_omitted" indicator when a query is present, fragment omitted.
   */
  displayUrl: string;
  /** Original ISO timestamp string from HAR entry.startedDateTime */
  startedDateTime: string;
  /** Milliseconds offset relative to the session timeline origin */
  startOffsetMs: number;
  /** Finite nonnegative duration in ms, or null if unknown/missing */
  durationMs: number | null;
  /**
   * Finite integer 0-599, or null if unknown/missing/invalid.
   * 0 denotes no HTTP status recorded by exporter.
   */
  status: number | null;
  /** Recorded response body size in bytes from response.bodySize, or null if unknown */
  bodyBytes: number | null;
  /** Normalized MIME type string, or null if missing */
  mimeType: string | null;
  /** Recorded phase breakdown, or null if none usable */
  timings: TimingPhases | null;
  /**
   * Request-specific data-quality warnings or limitations
   * (e.g. invalid status coerced to null, missing duration, negative timings omitted)
   * used when presenting selected request details.
   */
  warnings: RequestWarning[];
  /**
   * Ephemeral group identifier computed during parsing (method + original URL without credentials/fragment, including query).
   * Used to distinguish repeated requests with differing queries without leaking raw query values into the session.
   */
  urlGroupId: string;
}

export interface SessionTimeline {
  /** Unix timestamp in ms of the earliest usable request start, or null if recording contains no requests */
  originTimestampMs: number | null;
  /** Total span in ms: max(startOffsetMs + (durationMs ?? 0)) across all requests */
  totalSpanMs: number;
}

export interface SessionStats {
  totalRawEntries: number;
  acceptedEntries: number;
  skippedEntries: number;
  knownBodyBytesTotal: number;
  unknownBodyBytesCount: number;
  httpErrorCount: number;
  unknownStatusCount: number;
}

export type WarningSeverity = 'info' | 'warning' | 'error';

export interface SessionWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  affectedCount?: number;
}

export interface NormalizedSession {
  requests: NormalizedRequest[];
  timeline: SessionTimeline;
  stats: SessionStats;
  warnings: SessionWarning[];
}

export type FindingRuleId =
  | 'http-error'
  | 'no-http-status'
  | 'long-request'
  | 'large-body'
  | 'repeated-get';

export type ObservationLevel = 'error' | 'warning' | 'info';

export interface DiagnosticFinding {
  id: string;
  ruleId: FindingRuleId;
  label: string;
  observationLevel: ObservationLevel;
  requestIds: string[];
  /** Observed values pertinent to the rule (e.g. { actualDurationMs: 1420 }) */
  observedValues: Record<string, string | number>;
  /** Explicit configured threshold value applied (e.g. 1000 for duration, 1048576 for size) */
  threshold: string | number;
  explanation: string;
  nextInvestigation: string;
  limitations: string;
}

/**
 * Import limits and diagnostic thresholds.
 */
export const RULE_THRESHOLDS = {
  LONG_REQUEST_MS: 1000,
  LARGE_BODY_BYTES: 1048576, // 1 MiB (1,048,576 bytes)
  REPEATED_GET_MIN_COUNT: 3,
  REPEATED_GET_WINDOW_MS: 2000,
  HTTP_ERROR_MIN_STATUS: 400,
  HTTP_ERROR_MAX_STATUS: 599,
  MAX_FILE_BYTES: 10485760, // 10 MiB (10,485,760 bytes)
  MAX_RAW_ENTRIES: 2000,
  PAGE_SIZE: 100,
  FINDINGS_PAGE_SIZE: 10,
} as const;

export const DIAGNOSTIC_THRESHOLDS = RULE_THRESHOLDS;

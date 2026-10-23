import { NormalizedRequest, NormalizedSession, RULE_THRESHOLDS } from './types';

export type StatusFilterGroup =
  | 'all'
  | '2xx'
  | '3xx'
  | '4xx'
  | '5xx'
  | 'no-status'
  | 'unknown';

export interface ExplorerFilterState {
  searchQuery: string;
  selectedDomain: string; // 'all' or specific hostname
  statusGroup: StatusFilterGroup;
}

export type SortField =
  | 'startOffsetMs'
  | 'durationMs'
  | 'bodyBytes'
  | 'status'
  | 'method'
  | 'displayUrl';

export type SortDirection = 'asc' | 'desc';

export interface ExplorerSortState {
  field: SortField;
  direction: SortDirection;
}

export type WaterfallRenderKind = 'bar' | 'zero-point' | 'unknown-marker';

export interface WaterfallMetrics {
  leftPercent: number;
  widthPercent: number;
  isUnknownDuration: boolean;
  isZeroDuration: boolean;
  renderKind: WaterfallRenderKind;
  displayLabel: string;
}

export type WaterfallAlignmentClass = 'marker-at-start' | 'marker-centered' | 'marker-at-end';

export interface WaterfallRenderModel extends WaterfallMetrics {
  alignmentClass: WaterfallAlignmentClass;
  accessibleTitle: string;
}

export interface PaginatedResult<T> {
  items: T[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
}

export interface ExplorerSessionSummary {
  totalRequests: number;
  totalRawEntries: number;
  skippedEntries: number;
  acceptedEntries: number;
  httpErrorCount: number;
  noStatusCount: number;
  unknownStatusCount: number;
  totalSpanMs: number;
  originTimestampMs: number | null;
  knownBodyBytesTotal: number;
  unknownBodyBytesCount: number;
}

export const DEFAULT_FILTER_STATE: ExplorerFilterState = {
  searchQuery: '',
  selectedDomain: 'all',
  statusGroup: 'all',
};

export const DEFAULT_SORT_STATE: ExplorerSortState = {
  field: 'startOffsetMs',
  direction: 'asc',
};

/**
 * Checks if a request matches the active filter criteria.
 */
export function matchesFilter(
  request: NormalizedRequest,
  filters: ExplorerFilterState
): boolean {
  // 1. Search Query (matches method, displayUrl, hostname, or origin case-insensitively)
  const trimmedQuery = filters.searchQuery.trim().toLowerCase();
  if (trimmedQuery.length > 0) {
    const matchesMethod = request.method.toLowerCase().includes(trimmedQuery);
    const matchesUrl = request.displayUrl.toLowerCase().includes(trimmedQuery);
    const matchesHost = request.hostname.toLowerCase().includes(trimmedQuery);
    const matchesOrigin = request.origin.toLowerCase().includes(trimmedQuery);

    if (!matchesMethod && !matchesUrl && !matchesHost && !matchesOrigin) {
      return false;
    }
  }

  // 2. Domain Filter
  if (filters.selectedDomain !== 'all' && request.hostname !== filters.selectedDomain) {
    return false;
  }

  // 3. Status Group Filter
  switch (filters.statusGroup) {
    case '2xx':
      return request.status !== null && request.status >= 200 && request.status <= 299;
    case '3xx':
      return request.status !== null && request.status >= 300 && request.status <= 399;
    case '4xx':
      return request.status !== null && request.status >= 400 && request.status <= 499;
    case '5xx':
      return request.status !== null && request.status >= 500 && request.status <= 599;
    case 'no-status':
      return request.status === 0;
    case 'unknown':
      return request.status === null;
    case 'all':
    default:
      return true;
  }
}

/**
 * Pure filter function returning matching requests.
 * Does not mutate original requests.
 */
export function filterRequests(
  requests: readonly NormalizedRequest[],
  filters: ExplorerFilterState
): NormalizedRequest[] {
  return requests.filter((req) => matchesFilter(req, filters));
}

/**
 * Deterministic comparison function with the following ordering:
 * - Equal values break ties using original sourceIndex ascending.
 * - Unknown numeric values sort last in either direction (asc and desc).
 */
export function compareRequests(
  a: NormalizedRequest,
  b: NormalizedRequest,
  sort: ExplorerSortState
): number {
  const { field, direction } = sort;
  const isAsc = direction === 'asc';

  if (field === 'durationMs' || field === 'bodyBytes' || field === 'status') {
    const valA = a[field];
    const valB = b[field];

    if (valA === null && valB === null) {
      return a.sourceIndex - b.sourceIndex;
    }
    // Unknown numeric values sort last in BOTH directions
    if (valA === null) {
      return 1;
    }
    if (valB === null) {
      return -1;
    }

    if (valA !== valB) {
      return isAsc ? valA - valB : valB - valA;
    }
    return a.sourceIndex - b.sourceIndex;
  }

  if (field === 'startOffsetMs') {
    if (a.startOffsetMs !== b.startOffsetMs) {
      return isAsc
        ? a.startOffsetMs - b.startOffsetMs
        : b.startOffsetMs - a.startOffsetMs;
    }
    return a.sourceIndex - b.sourceIndex;
  }

  if (field === 'method' || field === 'displayUrl') {
    const strA = a[field];
    const strB = b[field];
    const cmp = strA.localeCompare(strB);
    if (cmp !== 0) {
      return isAsc ? cmp : -cmp;
    }
    return a.sourceIndex - b.sourceIndex;
  }

  return a.sourceIndex - b.sourceIndex;
}

/**
 * Pure sort function returning deterministically sorted requests.
 * Does not mutate the normalized session.
 */
export function sortRequests(
  requests: readonly NormalizedRequest[],
  sort: ExplorerSortState
): NormalizedRequest[] {
  return [...requests].sort((a, b) => compareRequests(a, b, sort));
}

/**
 * Paginates items with automatic page clamping.
 */
export function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number = RULE_THRESHOLDS.PAGE_SIZE
): PaginatedResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageItems = items.slice(startIndex, endIndex);

  return {
    items: pageItems,
    currentPage,
    totalPages,
    totalItems,
    startIndex,
    endIndex,
  };
}

/**
 * Computes waterfall timeline visual metrics for a single request.
 * - Handles all-zero extents with a minimum visual scale without changing true values.
 * - Unknown duration gets a marker (widthPercent: 0, isUnknownDuration: true).
 * - Defensively clips percentages to [0, 100].
 */
export function computeWaterfallMetrics(
  request: NormalizedRequest,
  sessionTotalSpanMs: number,
  minVisualSpanMs: number = 100
): WaterfallMetrics {
  const effectiveSpan = sessionTotalSpanMs > 0 ? sessionTotalSpanMs : minVisualSpanMs;

  const leftPercent = Math.max(0, Math.min(100, (request.startOffsetMs / effectiveSpan) * 100));

  if (request.durationMs === null) {
    return {
      leftPercent,
      widthPercent: 0,
      isUnknownDuration: true,
      isZeroDuration: false,
      renderKind: 'unknown-marker',
      displayLabel: 'Unknown duration',
    };
  }

  if (request.durationMs === 0) {
    return {
      leftPercent,
      widthPercent: 0,
      isUnknownDuration: false,
      isZeroDuration: true,
      renderKind: 'zero-point',
      displayLabel: '0 ms',
    };
  }

  const rawWidthPercent = (request.durationMs / effectiveSpan) * 100;
  const maxAvailableWidth = Math.max(0, 100 - leftPercent);
  const widthPercent = Math.max(0, Math.min(maxAvailableWidth, rawWidthPercent));

  return {
    leftPercent,
    widthPercent,
    isUnknownDuration: false,
    isZeroDuration: false,
    renderKind: 'bar',
    displayLabel: `${request.durationMs.toLocaleString()} ms`,
  };
}

/**
 * Shared production rendering model used by components to position and render waterfall elements.
 * Preserves exact computed widths and selects appropriate point markers without fabricating positive bars.
 */
export function computeWaterfallRenderModel(
  request: NormalizedRequest,
  sessionTotalSpanMs: number,
  minVisualSpanMs: number = 100
): WaterfallRenderModel {
  const metrics = computeWaterfallMetrics(request, sessionTotalSpanMs, minVisualSpanMs);

  let alignmentClass: WaterfallAlignmentClass = 'marker-centered';
  if (metrics.leftPercent >= 95) {
    alignmentClass = 'marker-at-end';
  } else if (metrics.leftPercent <= 5) {
    alignmentClass = 'marker-at-start';
  }

  let accessibleTitle = '';
  if (metrics.renderKind === 'unknown-marker') {
    accessibleTitle = `Start: +${request.startOffsetMs.toLocaleString()} ms (Unknown duration)`;
  } else if (metrics.renderKind === 'zero-point') {
    accessibleTitle = `Start: +${request.startOffsetMs.toLocaleString()} ms (Zero duration: 0 ms)`;
  } else {
    accessibleTitle = `Start: +${request.startOffsetMs.toLocaleString()} ms, Duration: ${metrics.displayLabel}`;
  }

  return {
    ...metrics,
    alignmentClass,
    accessibleTitle,
  };
}

/**
 * Extracts unique domain hostnames from a list of requests, sorted alphabetically.
 */
export function extractUniqueDomains(requests: readonly NormalizedRequest[]): string[] {
  const domains = new Set<string>();
  for (const req of requests) {
    if (req.hostname) {
      domains.add(req.hostname);
    }
  }
  return Array.from(domains).sort((a, b) => a.localeCompare(b));
}

/**
 * Computes complete summary statistics for the session explorer.
 * Keeps status 0 distinct from unknown, and known-byte totals distinct from unknown-size counts.
 */
export function computeSessionSummary(session: NormalizedSession): ExplorerSessionSummary {
  let noStatusCount = 0;
  let unknownStatusCount = 0;
  let httpErrorCount = 0;
  let knownBodyBytesTotal = 0;
  let unknownBodyBytesCount = 0;

  for (const req of session.requests) {
    if (req.status === 0) {
      noStatusCount++;
    } else if (req.status === null) {
      unknownStatusCount++;
    } else if (req.status >= 400 && req.status <= 599) {
      httpErrorCount++;
    }

    if (req.bodyBytes !== null) {
      knownBodyBytesTotal += req.bodyBytes;
    } else {
      unknownBodyBytesCount++;
    }
  }

  return {
    totalRequests: session.requests.length,
    totalRawEntries: session.stats.totalRawEntries,
    skippedEntries: session.stats.skippedEntries,
    acceptedEntries: session.stats.acceptedEntries,
    httpErrorCount,
    noStatusCount,
    unknownStatusCount,
    totalSpanMs: session.timeline.totalSpanMs,
    originTimestampMs: session.timeline.originTimestampMs,
    knownBodyBytesTotal,
    unknownBodyBytesCount,
  };
}

import React, { useState, useMemo, useEffect } from 'react';
import {
  NormalizedSession,
  RULE_THRESHOLDS,
} from '../domain/types';
import {
  ExplorerFilterState,
  ExplorerSortState,
  DEFAULT_FILTER_STATE,
  DEFAULT_SORT_STATE,
  StatusFilterGroup,
  SortField,
  filterRequests,
  sortRequests,
  paginateItems,
  computeWaterfallRenderModel,
  extractUniqueDomains,
  matchesFilter,
} from '../domain/explorer';

export interface NavigationTarget {
  requestId: string;
  relatedIds?: string[];
  timestamp: number;
}

interface RequestExplorerProps {
  session: NormalizedSession;
  navigationTarget?: NavigationTarget | null;
  onSelectedRequestChange?: (requestId: string | null) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms).toLocaleString()} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export const RequestExplorer: React.FC<RequestExplorerProps> = ({
  session,
  navigationTarget,
  onSelectedRequestChange,
}) => {
  const [filters, setFilters] = useState<ExplorerFilterState>(DEFAULT_FILTER_STATE);
  const [sort, setSort] = useState<ExplorerSortState>(DEFAULT_SORT_STATE);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [highlightedRequestIds, setHighlightedRequestIds] = useState<string[]>([]);
  const [filterResetNotice, setFilterResetNotice] = useState<string | null>(null);

  // Reset filters, sort, pagination, and selection whenever the session instance changes
  useEffect(() => {
    setFilters(DEFAULT_FILTER_STATE);
    setSort(DEFAULT_SORT_STATE);
    setCurrentPage(1);
    setSelectedRequestId(null);
    setHighlightedRequestIds([]);
    setFilterResetNotice(null);
    onSelectedRequestChange?.(null);
  }, [session]);

  const uniqueDomains = useMemo(() => {
    return extractUniqueDomains(session.requests);
  }, [session.requests]);

  const filteredRequests = useMemo(() => {
    return filterRequests(session.requests, filters);
  }, [session.requests, filters]);

  const sortedRequests = useMemo(() => {
    return sortRequests(filteredRequests, sort);
  }, [filteredRequests, sort]);

  const paginatedResult = useMemo(() => {
    return paginateItems(sortedRequests, currentPage, RULE_THRESHOLDS.PAGE_SIZE);
  }, [sortedRequests, currentPage]);

  // Keep pagination clamped if sortedRequests length changes
  useEffect(() => {
    if (currentPage > paginatedResult.totalPages) {
      setCurrentPage(paginatedResult.totalPages);
    }
  }, [currentPage, paginatedResult.totalPages]);

  const selectedRequest = useMemo(() => {
    if (!selectedRequestId) return null;
    return session.requests.find((r) => r.id === selectedRequestId) ?? null;
  }, [session.requests, selectedRequestId]);

  const isSelectedRequestInFiltered = useMemo(() => {
    if (!selectedRequestId) return false;
    return filteredRequests.some((r) => r.id === selectedRequestId);
  }, [filteredRequests, selectedRequestId]);

  const hasActiveFilters =
    filters.searchQuery.trim().length > 0 ||
    filters.selectedDomain !== 'all' ||
    filters.statusGroup !== 'all';

  const handleClearFilters = () => {
    setFilters(DEFAULT_FILTER_STATE);
    setCurrentPage(1);
  };

  const handleSortFieldChange = (field: SortField) => {
    if (sort.field === field) {
      // Toggle direction if clicking same field
      setSort((prev) => ({
        ...prev,
        direction: prev.direction === 'asc' ? 'desc' : 'asc',
      }));
    } else {
      // Default to ascending for newly selected field
      setSort({ field, direction: 'asc' });
    }
  };

  const handleRevealSelectedRequest = () => {
    if (!selectedRequestId) return;
    // Clear filters so the request is visible
    setFilters(DEFAULT_FILTER_STATE);
    // Find page of selected request in unfiltered sorted list
    const unfilteredSorted = sortRequests(session.requests, sort);
    const index = unfilteredSorted.findIndex((r) => r.id === selectedRequestId);
    if (index >= 0) {
      const targetPage = Math.floor(index / RULE_THRESHOLDS.PAGE_SIZE) + 1;
      setCurrentPage(targetPage);
    }
  };

  // Handle evidence navigation from Findings panel
  useEffect(() => {
    if (!navigationTarget) return;

    const targetReq = session.requests.find((r) => r.id === navigationTarget.requestId);
    if (!targetReq) return;

    // Check if current active filters would hide the target request
    const wouldMatch = matchesFilter(targetReq, filters);
    let effectiveFilters = filters;

    if (!wouldMatch) {
      // Clear filters so target request is visible
      effectiveFilters = DEFAULT_FILTER_STATE;
      setFilters(DEFAULT_FILTER_STATE);
      setFilterResetNotice(
        `Active filters were cleared to reveal diagnostic evidence for ${targetReq.id} (${targetReq.method} ${targetReq.displayUrl}).`
      );
    }

    // Set selected request
    setSelectedRequestId(navigationTarget.requestId);
    onSelectedRequestChange?.(navigationTarget.requestId);

    // Set highlighted request IDs (all requests in the finding)
    setHighlightedRequestIds(navigationTarget.relatedIds ?? [navigationTarget.requestId]);

    // Compute which page the target request will be on
    const currentFiltered = filterRequests(session.requests, effectiveFilters);
    const currentSorted = sortRequests(currentFiltered, sort);
    const targetIndex = currentSorted.findIndex((r) => r.id === navigationTarget.requestId);

    if (targetIndex !== -1) {
      const targetPage = Math.floor(targetIndex / RULE_THRESHOLDS.PAGE_SIZE) + 1;
      setCurrentPage(targetPage);
    }

    // Smooth scroll to table row after layout
    setTimeout(() => {
      const rowEl = document.getElementById(`request-row-${navigationTarget.requestId}`);
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        rowEl.focus();
      }
    }, 60);
  }, [navigationTarget]);

  const handleRowClick = (reqId: string) => {
    setSelectedRequestId((prev) => {
      const next = prev === reqId ? null : reqId;
      onSelectedRequestChange?.(next);
      return next;
    });
  };

  const handleRowKeyDown = (event: React.KeyboardEvent, reqId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleRowClick(reqId);
    }
  };

  const totalSpanMs = session.timeline.totalSpanMs;

  return (
    <section className="explorer-card" aria-labelledby="explorer-heading">
      <div className="explorer-header">
        <div className="explorer-title-group">
          <h2 id="explorer-heading" className="section-title">
            Request Explorer &amp; Timeline
          </h2>
          <p className="section-desc">
            Explore requests on an aligned session timeline. Filter by URL, method, domain, or HTTP
            status group; sort deterministically; and inspect individual request timing and limitations.
          </p>
        </div>
      </div>

      
      <div className="filters-toolbar" role="search" aria-label="Request filters">
        <div className="filter-item filter-search">
          <label htmlFor="explorer-search" className="filter-label">
            Search
          </label>
          <input
            id="explorer-search"
            type="search"
            className="filter-input"
            placeholder="Filter by method, URL, or host..."
            value={filters.searchQuery}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, searchQuery: e.target.value }));
              setCurrentPage(1);
            }}
          />
        </div>

        <div className="filter-item">
          <label htmlFor="explorer-domain" className="filter-label">
            Domain
          </label>
          <select
            id="explorer-domain"
            className="filter-select"
            value={filters.selectedDomain}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, selectedDomain: e.target.value }));
              setCurrentPage(1);
            }}
          >
            <option value="all">All Domains ({session.requests.length})</option>
            {uniqueDomains.map((domain) => {
              const count = session.requests.filter((r) => r.hostname === domain).length;
              return (
                <option key={domain} value={domain}>
                  {domain} ({count})
                </option>
              );
            })}
          </select>
        </div>

        <div className="filter-item">
          <label htmlFor="explorer-status" className="filter-label">
            Status Group
          </label>
          <select
            id="explorer-status"
            className="filter-select"
            value={filters.statusGroup}
            onChange={(e) => {
              setFilters((prev) => ({
                ...prev,
                statusGroup: e.target.value as StatusFilterGroup,
              }));
              setCurrentPage(1);
            }}
          >
            <option value="all">All Statuses</option>
            <option value="2xx">2xx Success</option>
            <option value="3xx">3xx Redirection</option>
            <option value="4xx">4xx Client Error</option>
            <option value="5xx">5xx Server Error</option>
            <option value="no-status">No HTTP Status (Status 0)</option>
            <option value="unknown">Unknown Status</option>
          </select>
        </div>

        <div className="filter-item">
          <label htmlFor="explorer-sort-field" className="filter-label">
            Sort By
          </label>
          <div className="sort-controls-group">
            <select
              id="explorer-sort-field"
              className="filter-select"
              value={sort.field}
              onChange={(e) => {
                setSort((prev) => ({
                  ...prev,
                  field: e.target.value as SortField,
                }));
              }}
            >
              <option value="startOffsetMs">Timeline Start</option>
              <option value="durationMs">Duration</option>
              <option value="bodyBytes">Body Size</option>
              <option value="status">HTTP Status</option>
              <option value="method">Method</option>
            </select>

            <button
              type="button"
              className="action-btn-small"
              onClick={() =>
                setSort((prev) => ({
                  ...prev,
                  direction: prev.direction === 'asc' ? 'desc' : 'asc',
                }))
              }
              aria-label={`Sort direction: currently ${
                sort.direction === 'asc' ? 'ascending' : 'descending'
              }. Click to toggle.`}
              title="Toggle sort direction"
            >
              {sort.direction === 'asc' ? '▲ Asc' : '▼ Desc'}
            </button>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="filter-item filter-clear-container">
            <button
              type="button"
              className="action-btn-small clear-btn"
              onClick={handleClearFilters}
              id="btn-clear-filters"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      
      {filterResetNotice && (
          <div className="filter-reset-banner" role="status" aria-live="polite">
            <span className="banner-text"> {filterResetNotice}</span>
            <button
              type="button"
              className="btn-dismiss-banner"
              onClick={() => setFilterResetNotice(null)}
              aria-label="Dismiss notice"
            >
              ✕ Dismiss
            </button>
          </div>
        )}

        
        <div className="results-status-bar" aria-live="polite">
        <span className="results-count-text">
          Showing{' '}
          <strong>
            {paginatedResult.totalItems === 0
              ? '0'
              : `${paginatedResult.startIndex + 1}–${paginatedResult.endIndex}`}
          </strong>{' '}
          of <strong>{paginatedResult.totalItems}</strong> matching requests
          {hasActiveFilters && ` (filtered from ${session.requests.length} total)`}
        </span>
        <span className="timeline-scale-disclaimer">
          Session timeline: 0 ms to {formatDuration(totalSpanMs)} &bull; Waterfall bars share one
          session scale; summed request durations do not equal elapsed time due to concurrency.
        </span>
      </div>

      
      {session.requests.length > 0 && filteredRequests.length === 0 && (
        <div className="no-results-card" role="region" aria-label="No Matching Requests">
          <span className="no-results-icon" aria-hidden="true">
            
          </span>
          <div className="no-results-content">
            <h3 className="no-results-title">No Requests Match Active Filters</h3>
            <p>
              Your current filter criteria did not match any requests in this session. Try adjusting
              your search query, domain, or status filter.
            </p>
            <button
              type="button"
              className="action-btn action-btn-primary"
              onClick={handleClearFilters}
              style={{ marginTop: '0.75rem', alignSelf: 'flex-start' }}
            >
              Clear All Filters
            </button>
          </div>
        </div>
      )}

      
      {filteredRequests.length > 0 && (
        <div className="table-responsive-container">
          <table className="request-table" aria-label="Network Requests List">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="col-method sortable"
                  onClick={() => handleSortFieldChange('method')}
                  aria-sort={
                    sort.field === 'method'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Method {sort.field === 'method' && (sort.direction === 'asc' ? '▲' : '▼')}
                </th>
                <th
                  scope="col"
                  className="col-status sortable"
                  onClick={() => handleSortFieldChange('status')}
                  aria-sort={
                    sort.field === 'status'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Status {sort.field === 'status' && (sort.direction === 'asc' ? '▲' : '▼')}
                </th>
                <th scope="col" className="col-url">
                  Sanitized URL &amp; Hostname
                </th>
                <th
                  scope="col"
                  className="col-duration sortable"
                  onClick={() => handleSortFieldChange('durationMs')}
                  aria-sort={
                    sort.field === 'durationMs'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Duration {sort.field === 'durationMs' && (sort.direction === 'asc' ? '▲' : '▼')}
                </th>
                <th
                  scope="col"
                  className="col-size sortable"
                  onClick={() => handleSortFieldChange('bodyBytes')}
                  aria-sort={
                    sort.field === 'bodyBytes'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Body Size {sort.field === 'bodyBytes' && (sort.direction === 'asc' ? '▲' : '▼')}
                </th>
                <th
                  scope="col"
                  className="col-waterfall sortable"
                  onClick={() => handleSortFieldChange('startOffsetMs')}
                  aria-sort={
                    sort.field === 'startOffsetMs'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <div className="waterfall-header-container">
                    <span className="waterfall-header-title">
                      Timeline Waterfall{' '}
                      {sort.field === 'startOffsetMs' && (sort.direction === 'asc' ? '▲' : '▼')}
                    </span>
                    
                    <div className="waterfall-ruler" aria-hidden="true">
                      <span className="ruler-tick tick-0">0 ms</span>
                      <span className="ruler-tick tick-25">
                        {formatDuration(totalSpanMs * 0.25)}
                      </span>
                      <span className="ruler-tick tick-50">
                        {formatDuration(totalSpanMs * 0.5)}
                      </span>
                      <span className="ruler-tick tick-75">
                        {formatDuration(totalSpanMs * 0.75)}
                      </span>
                      <span className="ruler-tick tick-100">{formatDuration(totalSpanMs)}</span>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedResult.items.map((req) => {
                const isSelected = req.id === selectedRequestId;
                const waterfallModel = computeWaterfallRenderModel(req, totalSpanMs);

                let statusBadgeClass = 'status-badge-neutral';
                let statusLabel = '—';
                if (req.status !== null) {
                  if (req.status === 0) {
                    statusBadgeClass = 'status-badge-zero';
                    statusLabel = '0 (No Status)';
                  } else if (req.status >= 200 && req.status < 300) {
                    statusBadgeClass = 'status-badge-2xx';
                    statusLabel = `${req.status}`;
                  } else if (req.status >= 300 && req.status < 400) {
                    statusBadgeClass = 'status-badge-3xx';
                    statusLabel = `${req.status}`;
                  } else if (req.status >= 400 && req.status < 500) {
                    statusBadgeClass = 'status-badge-4xx';
                    statusLabel = `${req.status}`;
                  } else if (req.status >= 500 && req.status < 600) {
                    statusBadgeClass = 'status-badge-5xx';
                    statusLabel = `${req.status}`;
                  } else {
                    statusLabel = `${req.status}`;
                  }
                } else {
                  statusBadgeClass = 'status-badge-unknown';
                  statusLabel = 'Unknown';
                }

                const isHighlighted = highlightedRequestIds.includes(req.id);

                return (
                  <tr
                    key={req.id}
                    id={`request-row-${req.id}`}
                    className={`request-row ${isSelected ? 'row-selected' : ''} ${
                      isHighlighted ? 'row-finding-highlight' : ''
                    }`}
                    onClick={() => handleRowClick(req.id)}
                    onKeyDown={(e) => handleRowKeyDown(e, req.id)}
                    tabIndex={0}
                    role="row"
                    aria-selected={isSelected}
                    aria-label={`Request ${req.id}: ${req.method} ${req.displayUrl}, status ${statusLabel}`}
                  >
                    <td className="col-method">
                      <span className={`method-badge method-${req.method.toLowerCase()}`}>
                        {req.method}
                      </span>
                    </td>
                    <td className="col-status">
                      <span className={`status-pill ${statusBadgeClass}`}>{statusLabel}</span>
                    </td>
                    <td className="col-url">
                      <div className="url-cell-content">
                        
                        <span className="url-display-text" title={req.displayUrl}>
                          {req.displayUrl}
                        </span>
                        <span className="host-text">{req.hostname}</span>
                      </div>
                    </td>
                    <td className="col-duration">
                      <span className="measurement-text">
                        {req.durationMs !== null ? formatDuration(req.durationMs) : 'Unknown'}
                      </span>
                    </td>
                    <td className="col-size">
                      <span className="measurement-text">
                        {req.bodyBytes !== null ? formatBytes(req.bodyBytes) : 'Unknown'}
                      </span>
                    </td>
                    <td className="col-waterfall">
                      <div className="waterfall-track" aria-hidden="true">
                        {waterfallModel.renderKind === 'unknown-marker' ? (
                          <div
                            className={`waterfall-marker-anchor ${waterfallModel.alignmentClass}`}
                            style={{ left: `${waterfallModel.leftPercent}%` }}
                            title={waterfallModel.accessibleTitle}
                          >
                            <span className="marker-diamond" aria-hidden="true" />
                            <span className="marker-unknown-label">Unknown</span>
                          </div>
                        ) : waterfallModel.renderKind === 'zero-point' ? (
                          <div
                            className={`waterfall-marker-anchor ${waterfallModel.alignmentClass}`}
                            style={{ left: `${waterfallModel.leftPercent}%` }}
                            title={waterfallModel.accessibleTitle}
                          >
                            <span className="marker-zero-pin" aria-hidden="true" />
                            <span className="marker-zero-label">0 ms</span>
                          </div>
                        ) : (
                          <div
                            className={`waterfall-bar ${
                              req.status && req.status >= 400 ? 'waterfall-bar-error' : ''
                            }`}
                            style={{
                              left: `${waterfallModel.leftPercent}%`,
                              width: `${waterfallModel.widthPercent}%`,
                            }}
                            title={waterfallModel.accessibleTitle}
                          >
                            <span
                              className={`waterfall-bar-label ${
                                waterfallModel.widthPercent < 5
                                  ? waterfallModel.leftPercent >= 80
                                    ? 'label-outside-left'
                                    : 'label-outside-right'
                                  : 'label-inside'
                              }`}
                            >
                              {waterfallModel.displayLabel}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      
      {filteredRequests.length > 0 && paginatedResult.totalPages > 1 && (
        <nav
          className="pagination-bar"
          aria-label="Request Table Pagination"
          role="navigation"
        >
          <div className="pagination-info">
            Page <strong>{paginatedResult.currentPage}</strong> of{' '}
            <strong>{paginatedResult.totalPages}</strong> ({RULE_THRESHOLDS.PAGE_SIZE} rows per page)
          </div>
          <div className="pagination-buttons">
            <button
              type="button"
              className="action-btn-small"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={paginatedResult.currentPage <= 1}
              id="btn-pagination-prev"
            >
              &larr; Previous
            </button>
            <button
              type="button"
              className="action-btn-small"
              onClick={() => setCurrentPage((p) => Math.min(paginatedResult.totalPages, p + 1))}
              disabled={paginatedResult.currentPage >= paginatedResult.totalPages}
              id="btn-pagination-next"
            >
              Next &rarr;
            </button>
          </div>
        </nav>
      )}

      
      {selectedRequest && (
        <aside
          className="request-details-panel"
          aria-labelledby="selected-request-heading"
          role="region"
        >
          
          {!isSelectedRequestInFiltered && (
            <div className="selected-hidden-banner" role="alert">
              <span aria-hidden="true"></span>
              <div className="hidden-banner-content">
                <strong>Selected Request is Hidden:</strong> Request{' '}
                <code>{selectedRequest.id}</code> does not match the active filters.
                <button
                  type="button"
                  className="action-btn-small clear-btn"
                  onClick={handleRevealSelectedRequest}
                  style={{ marginLeft: '1rem' }}
                  id="btn-reveal-selected"
                >
                  Clear Filters &amp; Reveal Request
                </button>
              </div>
            </div>
          )}

          <div className="details-header">
            <div className="details-title-row">
              <span className={`method-badge method-${selectedRequest.method.toLowerCase()}`}>
                {selectedRequest.method}
              </span>
              <h3 id="selected-request-heading" className="details-title">
                {selectedRequest.id} &bull; Request Details
              </h3>
            </div>
            <button
              type="button"
              className="action-btn-small"
              onClick={() => setSelectedRequestId(null)}
              aria-label="Close details panel"
              id="btn-close-details"
            >
              &times; Close Details
            </button>
          </div>

          <div className="details-grid">
            
            <div className="detail-section">
              <h4 className="detail-section-title">General &amp; URL Information</h4>
              <dl className="detail-dl">
                <div className="detail-dl-row">
                  <dt>Sanitized URL:</dt>
                  <dd>
                    
                    <code className="inert-url-code">{selectedRequest.displayUrl}</code>
                  </dd>
                </div>
                <div className="detail-dl-row">
                  <dt>Origin &amp; Hostname:</dt>
                  <dd>
                    <code>{selectedRequest.origin}</code>
                  </dd>
                </div>
                <div className="detail-dl-row">
                  <dt>Recorded Start:</dt>
                  <dd>
                    {selectedRequest.startedDateTime} (+
                    {formatDuration(selectedRequest.startOffsetMs)} from session origin)
                  </dd>
                </div>
                <div className="detail-dl-row">
                  <dt>HTTP Status:</dt>
                  <dd>
                    {selectedRequest.status !== null
                      ? selectedRequest.status === 0
                        ? '0 (No HTTP response status recorded by exporter)'
                        : `${selectedRequest.status}`
                      : 'Unknown / invalid status (coerced to null)'}
                  </dd>
                </div>
                <div className="detail-dl-row">
                  <dt>Recorded Duration:</dt>
                  <dd>
                    {selectedRequest.durationMs !== null
                      ? formatDuration(selectedRequest.durationMs)
                      : 'Unknown duration'}
                  </dd>
                </div>
                <div className="detail-dl-row">
                  <dt>Response Body Size:</dt>
                  <dd>
                    {selectedRequest.bodyBytes !== null
                      ? formatBytes(selectedRequest.bodyBytes)
                      : 'Unknown body size'}
                    <span className="measurement-note">
                      (Recorded from HAR <code>response.bodySize</code>. Cache hits, HTTP/2
                      compression, or exporter differences may cause this to differ from wire
                      transfer size.)
                    </span>
                  </dd>
                </div>
                <div className="detail-dl-row">
                  <dt>MIME Type:</dt>
                  <dd>{selectedRequest.mimeType || 'Not specified'}</dd>
                </div>
              </dl>
            </div>

            
            <div className="detail-section">
              <h4 className="detail-section-title">Recorded Timing Phases</h4>
              {selectedRequest.timings ? (
                <div className="timings-grid">
                  <div className="timing-phase-box">
                    <span className="timing-phase-name">Blocked</span>
                    <span className="timing-phase-val">
                      {selectedRequest.timings.blocked !== null &&
                      selectedRequest.timings.blocked !== undefined
                        ? formatDuration(selectedRequest.timings.blocked)
                        : '—'}
                    </span>
                  </div>
                  <div className="timing-phase-box">
                    <span className="timing-phase-name">DNS</span>
                    <span className="timing-phase-val">
                      {selectedRequest.timings.dns !== null &&
                      selectedRequest.timings.dns !== undefined
                        ? formatDuration(selectedRequest.timings.dns)
                        : '—'}
                    </span>
                  </div>
                  <div className="timing-phase-box">
                    <span className="timing-phase-name">Connect</span>
                    <span className="timing-phase-val">
                      {selectedRequest.timings.connect !== null &&
                      selectedRequest.timings.connect !== undefined
                        ? formatDuration(selectedRequest.timings.connect)
                        : '—'}
                    </span>
                  </div>
                  <div className="timing-phase-box">
                    <span className="timing-phase-name">SSL</span>
                    <span className="timing-phase-val">
                      {selectedRequest.timings.ssl !== null &&
                      selectedRequest.timings.ssl !== undefined
                        ? formatDuration(selectedRequest.timings.ssl)
                        : '—'}
                    </span>
                    <span className="timing-subnote">(subset of connect)</span>
                  </div>
                  <div className="timing-phase-box">
                    <span className="timing-phase-name">Send</span>
                    <span className="timing-phase-val">
                      {selectedRequest.timings.send !== null &&
                      selectedRequest.timings.send !== undefined
                        ? formatDuration(selectedRequest.timings.send)
                        : '—'}
                    </span>
                  </div>
                  <div className="timing-phase-box">
                    <span className="timing-phase-name">Wait (TTFB)</span>
                    <span className="timing-phase-val">
                      {selectedRequest.timings.wait !== null &&
                      selectedRequest.timings.wait !== undefined
                        ? formatDuration(selectedRequest.timings.wait)
                        : '—'}
                    </span>
                  </div>
                  <div className="timing-phase-box">
                    <span className="timing-phase-name">Receive</span>
                    <span className="timing-phase-val">
                      {selectedRequest.timings.receive !== null &&
                      selectedRequest.timings.receive !== undefined
                        ? formatDuration(selectedRequest.timings.receive)
                        : '—'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="empty-subtext">No timing breakdown phases recorded for this request.</p>
              )}
              <p className="timings-limitation-note">
                <strong>Timing Measurement Limitation:</strong> Timings represent exporter-recorded
                phase estimates. SSL negotiation is an internal subset of connect time and is not
                added twice to duration. Phase timing precision and availability vary across
                browsers and export environments.
              </p>
            </div>

            
            <div className="detail-section">
              <h4 className="detail-section-title">Request Data-Quality Warnings</h4>
              {selectedRequest.warnings.length > 0 ? (
                <ul className="request-warnings-list">
                  {selectedRequest.warnings.map((w, idx) => (
                    <li key={`${w.code}-${idx}`} className="request-warning-item">
                      <strong>{w.code}:</strong> {w.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="clean-subtext">
                  ✓ No request-level data quality warnings recorded.
                </p>
              )}
            </div>
          </div>
        </aside>
      )}
    </section>
  );
};

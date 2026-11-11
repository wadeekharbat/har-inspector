import React, { useState, useMemo, useEffect } from 'react';
import { DiagnosticFinding, ObservationLevel, RULE_THRESHOLDS } from '../domain/types';
import { computeDiagnosticsSummary, filterFindingsByLevel } from '../domain/diagnostics';
import { paginateItems } from '../domain/explorer';

interface FindingsPanelProps {
  findings: readonly DiagnosticFinding[];
  totalRequests: number;
  onNavigateToRequest: (targetRequestId: string, relatedRequestIds?: string[]) => void;
  selectedRequestId?: string | null;
  pageSize?: number;
  sessionKey?: string | number;
}

export const FindingsPanel: React.FC<FindingsPanelProps> = ({
  findings,
  totalRequests,
  onNavigateToRequest,
  selectedRequestId,
  pageSize,
  sessionKey,
}) => {
  const [levelFilter, setLevelFilter] = useState<'all' | ObservationLevel>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [lastSessionKey, setLastSessionKey] = useState<string | number | undefined>(sessionKey);
  const [lastFindings, setLastFindings] = useState<readonly DiagnosticFinding[]>(findings);

  // Reset filter and pagination when session or findings change
  if (sessionKey !== undefined && sessionKey !== lastSessionKey) {
    setLastSessionKey(sessionKey);
    setLevelFilter('all');
    setCurrentPage(1);
  } else if (sessionKey === undefined && findings !== lastFindings) {
    setLastFindings(findings);
    setLevelFilter('all');
    setCurrentPage(1);
  }

  const summary = useMemo(() => {
    return computeDiagnosticsSummary(findings, totalRequests);
  }, [findings, totalRequests]);

  const filteredFindings = useMemo(() => {
    return filterFindingsByLevel(findings, levelFilter);
  }, [findings, levelFilter]);

  const effectivePageSize = pageSize ?? RULE_THRESHOLDS.FINDINGS_PAGE_SIZE;

  const paginatedResult = useMemo(() => {
    return paginateItems(filteredFindings, currentPage, effectivePageSize);
  }, [filteredFindings, currentPage, effectivePageSize]);

  // Keep pagination clamped if filtered findings length shrinks
  useEffect(() => {
    if (currentPage > paginatedResult.totalPages) {
      setCurrentPage(paginatedResult.totalPages);
    }
  }, [currentPage, paginatedResult.totalPages]);

  const handleSelectLevel = (level: 'all' | ObservationLevel) => {
    setLevelFilter(level);
    setCurrentPage(1);
  };

  const getRuleBadgeLabel = (ruleId: string): string => {
    switch (ruleId) {
      case 'http-error':
        return 'HTTP Error (400–599)';
      case 'no-http-status':
        return 'Missing Status (Status 0)';
      case 'long-request':
        return 'Long Duration (≥ 1,000 ms)';
      case 'large-body':
        return 'Large Body (≥ 1 MiB)';
      case 'repeated-get':
        return 'Repeated GET (≥ 3 / 2 s)';
      default:
        return ruleId;
    }
  };

  return (
    <section className="findings-section" aria-labelledby="findings-heading">
      <div className="findings-header">
        <div>
          <h2 id="findings-heading" className="section-title">
            <span></span> Automated Diagnostic Findings
          </h2>
          <p className="section-desc">
            Findings flag request values recorded in this HAR.
          </p>
        </div>

        
        {totalRequests > 0 && (
          <div className="findings-summary-stats" role="group" aria-label="Diagnostic Findings Summary">
            <div className="findings-stat-pill stat-pill-total">
              <span className="stat-pill-label">Total Findings</span>
              <span className="stat-pill-value">{summary.totalFindings}</span>
            </div>
            {summary.errorCount > 0 && (
              <div className="findings-stat-pill stat-pill-error">
                <span className="stat-pill-label">Errors</span>
                <span className="stat-pill-value">{summary.errorCount}</span>
              </div>
            )}
            {summary.warningCount > 0 && (
              <div className="findings-stat-pill stat-pill-warning">
                <span className="stat-pill-label">Warnings</span>
                <span className="stat-pill-value">{summary.warningCount}</span>
              </div>
            )}
            {summary.infoCount > 0 && (
              <div className="findings-stat-pill stat-pill-info">
                <span className="stat-pill-label">Info</span>
                <span className="stat-pill-value">{summary.infoCount}</span>
              </div>
            )}
            <div className="findings-stat-pill stat-pill-affected">
              <span className="stat-pill-label">Affected Requests</span>
              <span className="stat-pill-value">
                {summary.uniqueAffectedRequestCount}{' '}
                <small className="stat-pill-sub">of {totalRequests}</small>
              </span>
            </div>
          </div>
        )}
      </div>

      
      {findings.length === 0 ? (
        <div className="findings-clean-card" role="region" aria-label="Diagnostic Findings Result">
          <span className="findings-clean-icon" aria-hidden="true">
            ✓
          </span>
          <div className="findings-clean-content">
            <h3 className="findings-clean-title">No Configured Diagnostic Rules Matched</h3>
            <p>
              None of the <strong>{totalRequests.toLocaleString()}</strong> requests in this recording
              met or exceeded the configured diagnostic thresholds for HTTP errors (400–599),
              missing response status (status 0), long durations (≥ 1,000 ms), large bodies (≥ 1 MiB),
              or repeated GET requests (≥ 3 within 2,000 ms).
            </p>
            <p className="findings-disclaimer-note">
              <strong>Scope limitation:</strong> This indicates an absence of matching rule triggers
              under fixed defaults. It does not prove that the application, backend services, or
              client network are healthy, performant, or bug-free.
            </p>
          </div>
        </div>
      ) : (
        <>
          
          <div className="findings-filter-bar" role="tablist" aria-label="Filter Findings by Level">
            <button
              type="button"
              role="tab"
              aria-selected={levelFilter === 'all'}
              className={`findings-filter-tab ${levelFilter === 'all' ? 'tab-active' : ''}`}
              onClick={() => handleSelectLevel('all')}
              id="tab-findings-all"
            >
              {`All (${findings.length})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={levelFilter === 'error'}
              className={`findings-filter-tab ${levelFilter === 'error' ? 'tab-active' : ''}`}
              onClick={() => handleSelectLevel('error')}
              id="tab-findings-error"
            >
              {`Errors (${summary.errorCount})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={levelFilter === 'warning'}
              className={`findings-filter-tab ${levelFilter === 'warning' ? 'tab-active' : ''}`}
              onClick={() => handleSelectLevel('warning')}
              id="tab-findings-warning"
            >
              {`Warnings (${summary.warningCount})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={levelFilter === 'info'}
              className={`findings-filter-tab ${levelFilter === 'info' ? 'tab-active' : ''}`}
              onClick={() => handleSelectLevel('info')}
              id="tab-findings-info"
            >
              {`Info (${summary.infoCount})`}
            </button>
          </div>

          
          {filteredFindings.length === 0 ? (
            <div className="findings-no-match" role="status" aria-label="No matching findings">
              <span className="findings-no-match-icon" aria-hidden="true"></span>
              <div className="findings-no-match-content">
                <h3 className="findings-no-match-title">
                  No {levelFilter === 'all' ? '' : levelFilter} findings match the selected filter
                </h3>
                <p className="findings-no-match-desc">
                  There are <strong>{findings.length}</strong> total findings recorded in this session,
                  but none have the observation level <strong>"{levelFilter}"</strong>.
                </p>
                <button
                  type="button"
                  className="action-btn-small action-btn-secondary"
                  onClick={() => handleSelectLevel('all')}
                  id="btn-clear-findings-filter"
                >
                  Show all findings ({findings.length})
                </button>
              </div>
            </div>
          ) : (
            <>
              
              <div className="findings-pagination-bar" role="navigation" aria-label="Findings pagination">
                <div className="findings-pagination-info">
                  Showing <strong>{`${paginatedResult.startIndex + 1}–${paginatedResult.endIndex}`}</strong> of <strong>{paginatedResult.totalItems}</strong> findings
                  {levelFilter !== 'all' && ` (${levelFilter})`}
                </div>

                {paginatedResult.totalPages > 1 && (
                  <div className="findings-pagination-controls">
                    <button
                      type="button"
                      className="action-btn-small"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={paginatedResult.currentPage <= 1}
                      aria-disabled={paginatedResult.currentPage <= 1}
                      id="btn-findings-prev-page"
                      aria-label="Previous findings page"
                    >
                      ← Previous
                    </button>

                    <span className="findings-page-indicator" aria-current="page">
                      {`Page ${paginatedResult.currentPage} of ${paginatedResult.totalPages}`}
                    </span>

                    <button
                      type="button"
                      className="action-btn-small"
                      onClick={() => setCurrentPage((p) => Math.min(paginatedResult.totalPages, p + 1))}
                      disabled={paginatedResult.currentPage >= paginatedResult.totalPages}
                      aria-disabled={paginatedResult.currentPage >= paginatedResult.totalPages}
                      id="btn-findings-next-page"
                      aria-label="Next findings page"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>

              
              <div className="findings-list" role="region" aria-label="Diagnostic Findings Cards">
                {paginatedResult.items.map((finding) => {
                  const isSelected =
                    selectedRequestId !== null &&
                    selectedRequestId !== undefined &&
                    finding.requestIds.includes(selectedRequestId);

                  return (
                    <article
                      key={finding.id}
                      id={`finding-card-${finding.id}`}
                      className={`finding-card finding-${finding.observationLevel} ${
                        isSelected ? 'finding-card-active' : ''
                      }`}
                      aria-labelledby={`heading-${finding.id}`}
                    >
                      <div className="finding-card-header">
                        <div className="finding-badges">
                          <span className={`finding-level-badge level-${finding.observationLevel}`}>
                            {finding.observationLevel === 'error' && '✕ Server Error'}
                            {finding.observationLevel === 'warning' && '▲ Warning'}
                            {finding.observationLevel === 'info' && ' Information'}
                          </span>
                          <span className="finding-rule-badge">
                            {getRuleBadgeLabel(finding.ruleId)}
                          </span>
                        </div>
                      </div>

                      
                      <div className="finding-measurements-table" role="table" aria-label="Observed measurements and threshold">
                        <div className="measurement-row" role="row">
                          <span className="measurement-label" role="rowheader">Configured Threshold:</span>
                          <span className="measurement-value" role="cell"><code>{finding.threshold}</code></span>
                        </div>
                        {finding.ruleId === 'http-error' && (
                          <div className="measurement-row" role="row">
                            <span className="measurement-label" role="rowheader">Recorded Status:</span>
                            <span className="measurement-value" role="cell"><code>{finding.observedValues.status}</code></span>
                          </div>
                        )}
                        {finding.ruleId === 'no-http-status' && (
                          <div className="measurement-row" role="row">
                            <span className="measurement-label" role="rowheader">Recorded Status:</span>
                            <span className="measurement-value" role="cell"><code>0 (no HTTP response captured)</code></span>
                          </div>
                        )}
                        {finding.ruleId === 'long-request' && (
                          <div className="measurement-row" role="row">
                            <span className="measurement-label" role="rowheader">Recorded Duration:</span>
                            <span className="measurement-value" role="cell"><code>{finding.observedValues.durationMs?.toLocaleString()} ms</code></span>
                          </div>
                        )}
                        {finding.ruleId === 'large-body' && (
                          <div className="measurement-row" role="row">
                            <span className="measurement-label" role="rowheader">Recorded Body Size:</span>
                            <span className="measurement-value" role="cell">
                              <code>{finding.observedValues.bodyBytes?.toLocaleString()} bytes ({finding.observedValues.formattedSize})</code>
                            </span>
                          </div>
                        )}
                        {finding.ruleId === 'repeated-get' && (
                          <div className="measurement-row" role="row">
                            <span className="measurement-label" role="rowheader">Qualifying Requests:</span>
                            <span className="measurement-value" role="cell">
                              <code>{finding.observedValues.qualifyingRequestCount} GET requests in {finding.observedValues.qualifyingWindowsCount} qualifying window(s)</code>
                            </span>
                          </div>
                        )}
                      </div>

                      <h3 id={`heading-${finding.id}`} className="finding-title">
                        {finding.label}
                      </h3>

                      <div className="finding-body">
                        <div className="finding-block">
                          <span className="finding-block-label">Observation:</span>
                          <p className="finding-block-text">{finding.explanation}</p>
                        </div>

                        <div className="finding-block">
                          <span className="finding-block-label">Next Investigation:</span>
                          <p className="finding-block-text">{finding.nextInvestigation}</p>
                        </div>

                        <div className="finding-block finding-limitations-block">
                          <span className="finding-block-label">Limitations:</span>
                          <p className="finding-block-text limitation-text">{finding.limitations}</p>
                        </div>
                      </div>

                      <div className="finding-footer">
                        <div className="finding-requests-group">
                          <span className="finding-requests-label">
                            Related Evidence ({finding.requestIds.length}{' '}
                            {finding.requestIds.length === 1 ? 'request' : 'requests'}):
                          </span>
                          <div className="finding-requests-pills">
                            {finding.requestIds.map((reqId) => {
                              const isReqSelected = reqId === selectedRequestId;
                              return (
                                <button
                                  key={reqId}
                                  type="button"
                                  className={`request-evidence-pill ${
                                    isReqSelected ? 'pill-selected' : ''
                                  }`}
                                  onClick={() => onNavigateToRequest(reqId, finding.requestIds)}
                                  title={`Inspect request ${reqId} in Explorer`}
                                  aria-label={`Inspect request ${reqId} in Explorer`}
                                  id={`pill-${finding.id}-${reqId}`}
                                >
                                  {reqId}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="action-btn-small action-btn-primary"
                          onClick={() => onNavigateToRequest(finding.requestIds[0], finding.requestIds)}
                          id={`btn-reveal-${finding.id}`}
                          aria-label={`Inspect evidence for ${finding.label}`}
                        >
                          <span>Inspect Evidence in Explorer →</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              
              {paginatedResult.totalPages > 1 && (
                <div className="findings-pagination-bar findings-pagination-bottom" role="navigation" aria-label="Findings pagination bottom">
                  <div className="findings-pagination-info">
                    Page {paginatedResult.currentPage} of {paginatedResult.totalPages} ({paginatedResult.totalItems} findings total)
                  </div>
                  <div className="findings-pagination-controls">
                    <button
                      type="button"
                      className="action-btn-small"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={paginatedResult.currentPage <= 1}
                      aria-disabled={paginatedResult.currentPage <= 1}
                      id="btn-findings-prev-page-bottom"
                      aria-label="Previous findings page"
                    >
                      ← Previous
                    </button>

                    <span className="findings-page-indicator" aria-current="page">
                      {`Page ${paginatedResult.currentPage} of ${paginatedResult.totalPages}`}
                    </span>

                    <button
                      type="button"
                      className="action-btn-small"
                      onClick={() => setCurrentPage((p) => Math.min(paginatedResult.totalPages, p + 1))}
                      disabled={paginatedResult.currentPage >= paginatedResult.totalPages}
                      aria-disabled={paginatedResult.currentPage >= paginatedResult.totalPages}
                      id="btn-findings-next-page-bottom"
                      aria-label="Next findings page"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
};

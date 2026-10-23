import React, { useState, useEffect, useRef, useMemo } from 'react';
import './styles.css';
import { ImportController, type ImportState } from './domain/import-controller';
import { RULE_THRESHOLDS } from './domain/types';
import { computeSessionSummary } from './domain/explorer';
import { evaluateDiagnostics } from './domain/diagnostics';
import { RequestExplorer, type NavigationTarget } from './components/RequestExplorer';
import { FindingsPanel } from './components/FindingsPanel';
import { DemoGuide } from './components/DemoGuide';
import { ExportHelpModal } from './components/ExportHelpModal';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms).toLocaleString()} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export const App: React.FC = () => {
  const controllerRef = useRef<ImportController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ImportController();
  }
  const controller = controllerRef.current;

  const [state, setState] = useState<ImportState>(() => controller.getState());
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);
  const [activeSelectedRequestId, setActiveSelectedRequestId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<number>(0);
  const [isExportHelpOpen, setIsExportHelpOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return controller.subscribe((nextState) => {
      setState((prevState) => {
        if (nextState.currentSession !== prevState.currentSession) {
          setSessionKey((k) => k + 1);
        }
        return nextState;
      });
      setNavigationTarget(null);
      setActiveSelectedRequestId(null);
    });
  }, [controller]);

  const handleLoadDemo = async () => {
    await controller.loadDemo();
  };

  const handleLoadCleanDemo = async () => {
    await controller.loadCleanDemo();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input value so re-importing the same file triggers change
    event.target.value = '';

    await controller.importFile({
      name: file.name,
      size: file.size,
      text: () => file.text(),
    });
  };

  const handleReset = () => {
    controller.reset();
  };

  const isLoading = state.status === 'loading';
  const hasSession = Boolean(state.currentSession);
  const session = state.currentSession;
  const isBrokenCheckoutDemo = state.sourceKind === 'bundled-checkout-demo';

  const summary = useMemo(() => {
    if (!session) return null;
    return computeSessionSummary(session);
  }, [session]);

  const findings = useMemo(() => {
    if (!session || session.requests.length === 0) return [];
    return evaluateDiagnostics(session.requests);
  }, [session]);

  const handleNavigateToRequest = (targetRequestId: string, relatedRequestIds?: string[]) => {
    setNavigationTarget({
      requestId: targetRequestId,
      relatedIds: relatedRequestIds,
      timestamp: Date.now(),
    });
    setActiveSelectedRequestId(targetRequestId);
  };

  return (
    <main className="app-container">
      
      <header className="app-header">
        <div className="header-brand">
          <h1 className="brand-title">HAR Inspector</h1>
          <span className="stage-badge stage-badge-portfolio">HAR network analysis</span>
        </div>
        <p className="brand-purpose">
          Inspect HTTP failures, slow requests, payload sizes, and repeated calls in a HAR recording.
        </p>
      </header>

      
      <section className="privacy-callout" aria-label="Privacy and Data Handling Notice">
        <span className="callout-icon" aria-hidden="true"></span>
        <div className="callout-body">
          <p><strong>Local processing.</strong> Recordings stay in browser memory and are cleared on reset or reload. Headers, cookies, bodies, credentials, and query values are excluded from the normalized data.</p>
          <p><strong>Review before sharing.</strong> Hostnames and URL paths can still contain sensitive information. Use sanitized recordings.</p>
        </div>
      </section>

      
      <section className="actions-card" aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="section-title">Open a recording</h2>
        <p className="section-desc">
          Import a HAR file (up to 10 MiB and 2,000 entries), or explore a synthetic example.
        </p>

        <div className="action-buttons-group">
          <button
            type="button"
            className="action-btn action-btn-primary"
            onClick={handleLoadDemo}
            disabled={isLoading}
            aria-disabled={isLoading}
            id="btn-load-demo"
          >
            <span>Load Demo: Broken Checkout</span>
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={handleLoadCleanDemo}
            disabled={isLoading}
            aria-disabled={isLoading}
            id="btn-load-clean-demo"
          >
            <span>Load Clean Example</span>
          </button>

          <label
            htmlFor="har-file-input"
            className={`action-btn ${isLoading ? 'disabled' : ''}`}
            aria-disabled={isLoading}
            id="lbl-import-file"
          >
            <span>Import HAR Recording (.har / .json)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            id="har-file-input"
            accept=".har,.json,application/json"
            onChange={handleFileChange}
            disabled={isLoading}
            className="sr-only"
            aria-label="Upload HAR or JSON file"
          />

          <button
            type="button"
            className="action-btn action-btn-outline"
            onClick={() => setIsExportHelpOpen(true)}
            id="btn-open-export-help"
            aria-haspopup="dialog"
          >
            <span>How to Export HAR</span>
          </button>

          <button
            type="button"
            className="action-btn action-btn-danger"
            onClick={handleReset}
            disabled={isLoading || (!hasSession && !state.error)}
            aria-disabled={isLoading || (!hasSession && !state.error)}
            id="btn-reset-session"
          >
            <span>Reset Session</span>
          </button>
        </div>

        
        <div className="sr-only" aria-live="polite">
          {isLoading && 'Reading and normalizing HAR recording...'}
          {state.status === 'success' && `Session loaded: ${state.activeSource}`}
          {state.status === 'error' && `Import failed: ${state.error}`}
          {state.status === 'idle' && 'Session reset.'}
        </div>
      </section>

      
      {isLoading && (
        <section className="loading-indicator" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <span>Reading and normalizing HAR recording in browser memory...</span>
        </section>
      )}

      
      {state.error && (
        <section className="alert-banner" role="alert" aria-live="assertive">
          <span className="alert-icon" aria-hidden="true"></span>
          <div className="alert-content">
            <h3 className="alert-title">Import Failed</h3>
            <p>{state.error}</p>
            {hasSession && (
              <p className="alert-preserved-note">
                <strong>Last-Good Session Preserved:</strong> The previous valid recording ({state.activeSource})
                remains active in memory.
              </p>
            )}
          </div>
        </section>
      )}

      
      {session && (
        <section className="session-summary-card" aria-labelledby="session-summary-heading">
          <div className="session-header">
            <div className="session-title-group">
              <h2 id="session-summary-heading" className="session-source-name">
                {state.activeSource}
              </h2>
              <p className="session-subtext">
                Normalized in-memory session &bull; Timeline Origin:{' '}
                {session.timeline.originTimestampMs !== null
                  ? new Date(session.timeline.originTimestampMs).toISOString()
                  : 'Unavailable (no requests recorded)'}
              </p>
            </div>
            <span className="stage-badge" style={{ backgroundColor: 'rgba(52, 211, 153, 0.12)', borderColor: 'rgba(52, 211, 153, 0.4)', color: '#34d399' }}>
              Import Verified
            </span>
          </div>

          
          {session.requests.length === 0 && (
            <div className="empty-recording-card" role="region" aria-label="Empty Recording Notice">
              <span className="empty-icon" aria-hidden="true"></span>
              <div className="empty-content">
                <h3 className="empty-title">Empty Recording (0 Requests)</h3>
                <p>
                  The imported file contains a valid HAR log with an empty entries array. No HTTP network
                  requests were recorded in this session.
                </p>
              </div>
            </div>
          )}

          
          {summary && (
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label">Accepted Requests</span>
                <span className="stat-value">{summary.acceptedEntries.toLocaleString()}</span>
                <span className="stat-sub">of {summary.totalRawEntries.toLocaleString()} raw entries</span>
              </div>

              <div className="stat-box">
                <span className="stat-label">Skipped Entries</span>
                <span className="stat-value" style={{ color: summary.skippedEntries > 0 ? '#fbbf24' : undefined }}>
                  {summary.skippedEntries.toLocaleString()}
                </span>
                <span className="stat-sub">{summary.skippedEntries > 0 ? 'Invalid structure' : 'None skipped'}</span>
              </div>

              <div className="stat-box">
                <span className="stat-label">Timeline Span</span>
                <span className="stat-value">{formatDuration(summary.totalSpanMs)}</span>
                <span className="stat-sub">
                  {session.requests.length === 0 ? 'No requests recorded' : 'Earliest start to last extent (not page load time)'}
                </span>
              </div>

              <div className="stat-box">
                <span className="stat-label">Recorded Body Total</span>
                <span className="stat-value">{formatBytes(summary.knownBodyBytesTotal)}</span>
                <span className="stat-sub">
                  {summary.unknownBodyBytesCount > 0
                    ? `${summary.unknownBodyBytesCount} unknown size`
                    : 'All sizes known'}
                </span>
              </div>

              <div className="stat-box">
                <span className="stat-label">HTTP Errors (4xx/5xx)</span>
                <span className={`stat-value ${summary.httpErrorCount > 0 ? 'error-highlight' : ''}`}>
                  {summary.httpErrorCount}
                </span>
                <span className="stat-sub">Recorded 400–599 status</span>
              </div>

              <div className="stat-box">
                <span className="stat-label">No HTTP Status</span>
                <span className="stat-value">{summary.noStatusCount}</span>
                <span className="stat-sub">Status 0 recorded by exporter</span>
              </div>

              <div className="stat-box">
                <span className="stat-label">Unknown Status</span>
                <span className="stat-value">{summary.unknownStatusCount}</span>
                <span className="stat-sub">Missing / invalid HTTP status</span>
              </div>
            </div>
          )}

          
          {session.warnings.length > 0 && (
            <div className="warnings-card" aria-labelledby="warnings-heading">
              <h3 id="warnings-heading" className="warnings-title">
                <span></span> Session Warnings ({session.warnings.length})
              </h3>
              {session.warnings.map((w, idx) => (
                <div key={`${w.code}-${idx}`} className="warning-row">
                  <span className={`severity-pill ${w.severity}`}>{w.severity}</span>
                  <div>
                    <strong>{w.code}:</strong> {w.message}
                  </div>
                </div>
              ))}
            </div>
          )}

          
          <FindingsPanel
            key={`findings-session-${sessionKey}`}
            sessionKey={sessionKey}
            findings={findings}
            totalRequests={session.requests.length}
            onNavigateToRequest={handleNavigateToRequest}
            selectedRequestId={activeSelectedRequestId}
          />
        </section>
      )}

      
      {isBrokenCheckoutDemo && session && session.requests.length > 0 && (
        <DemoGuide onNavigateToRequest={handleNavigateToRequest} />
      )}

      
      {session && session.requests.length > 0 && (
        <RequestExplorer
          session={session}
          navigationTarget={navigationTarget}
          onSelectedRequestChange={setActiveSelectedRequestId}
        />
      )}

      
      <div className="info-grid">
        
        <section className="info-card" aria-labelledby="guardrails-heading">
          <h3 id="guardrails-heading" className="card-title">
            <span></span> Import limits
          </h3>
          <ul className="feature-list">
            <li className="feature-item">
              <span className="feature-name">File Size Ceiling</span>
              <span className="feature-detail">
                {RULE_THRESHOLDS.MAX_FILE_BYTES.toLocaleString()} bytes (10 MiB) enforced before reading into memory.
              </span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Raw Entry Limit</span>
              <span className="feature-detail">
                Maximum {RULE_THRESHOLDS.MAX_RAW_ENTRIES.toLocaleString()} raw entries rejected before normalization.
              </span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Display Sanitization</span>
              <span className="feature-detail">
                Credentials, fragments, and queries replaced with <code>?query_omitted</code>.
              </span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Ephemeral Grouping</span>
              <span className="feature-detail">
                Requests grouped by method + full URL with queries during parsing; raw keys strictly cleared after normalization.
              </span>
            </li>
          </ul>
        </section>

        
        <section className="info-card" aria-labelledby="heuristics-heading">
          <h3 id="heuristics-heading" className="card-title">
            <span></span> Diagnostic rules
          </h3>
          <ul className="feature-list">
            <li className="feature-item">
              <span className="feature-name">HTTP Error Response</span>
              <span className="feature-detail">Flags requests with HTTP status between 400 and 599.</span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Missing HTTP Status</span>
              <span className="feature-detail">Informational flag for status 0 (no HTTP response recorded).</span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Long Request</span>
              <span className="feature-detail">Duration &ge; 1,000 ms flagged for latency review.</span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Large Recorded Body</span>
              <span className="feature-detail">Known bodySize &ge; 1,048,576 bytes (1 MiB via response.bodySize).</span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Repeated GET Requests</span>
              <span className="feature-detail">&ge; 3 qualifying GETs to the same full URL within 2,000 ms.</span>
            </li>
          </ul>
        </section>

        
        <section className="info-card" aria-labelledby="arch-heading">
          <h3 id="arch-heading" className="card-title">
            <span></span> How it works
          </h3>
          <ul className="feature-list">
            <li className="feature-item">
              <span className="feature-name">100% In-Browser Execution</span>
              <span className="feature-detail">
                Zero backend, zero telemetry, zero analytics. HAR logs are processed directly in browser memory and discarded on tab close or session reset.
              </span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Deterministic Heuristics</span>
              <span className="feature-detail">
                Rule-based diagnostics explain exactly which timing or status condition was met without speculative or ungrounded claims.
              </span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Sanitized In-Memory Normalization</span>
              <span className="feature-detail">
                URL query parameters, cookies, and authorization headers are stripped during ingestion to preserve diagnostic utility while reducing accidental disclosure.
              </span>
            </li>
            <li className="feature-item">
              <span className="feature-name">Implementation</span>
              <span className="feature-detail">
                Engineered with React 18, strict TypeScript, and pure CSS for accessible, responsive, local network inspection.
              </span>
            </li>
          </ul>
        </section>
      </div>

      
      <footer className="app-footer">
        <p>HAR Inspector v0.1.0 &bull; Client-side HAR network activity inspector</p>
      </footer>

      
      <ExportHelpModal
        isOpen={isExportHelpOpen}
        onClose={() => setIsExportHelpOpen(false)}
      />
    </main>
  );
};

export default App;


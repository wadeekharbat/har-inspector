import React, { useEffect, useRef } from 'react';
import { RULE_THRESHOLDS } from '../domain/types';

interface ExportHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportHelpModal: React.FC<ExportHelpModalProps> = ({ isOpen, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Capture the element that triggered the modal to restore focus on exit
    const previousActiveElement = document.activeElement as HTMLElement | null;

    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusableElements = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !dialog.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !dialog.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
      aria-hidden={!isOpen}
    >
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-help-title"
        onClick={(e) => e.stopPropagation()} // Prevent clicks inside modal from closing
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon" aria-hidden="true"></span>
            <h2 id="export-help-title" className="modal-title">
              How to Export HAR Recordings from Chrome
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close export help modal"
            id="btn-close-export-help"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          
          <section className="modal-section">
            <h3 className="modal-section-title">1. Exporting from Chrome DevTools</h3>
            <p className="modal-text">
              HAR Inspector supports HTTP Archive (HAR 1.2) files generated from Chromium-based browsers
              (Chrome, Edge, Brave). Follow official Chromium export options:
            </p>
            <ol className="modal-steps-list">
              <li>
                <strong>Open Network Panel:</strong> Press <code>F12</code> or{' '}
                <code>Ctrl+Shift+I</code> (Windows/Linux) / <code>Cmd+Option+I</code> (macOS), then
                select the <strong>Network</strong> tab.
              </li>
              <li>
                <strong>Record the Scenario:</strong> Ensure network recording is active (red circle),
                then reproduce the slow or failing user flow in your browser.
              </li>
              <li>
                <strong>Export Option A — Network Toolbar:</strong> Click the{' '}
                <strong>Export HAR (sanitized)</strong> button (downward arrow icon) in the Network
                toolbar to download the recording.
              </li>
              <li>
                <strong>Export Option B — Request Context Menu:</strong> Right-click any row in the network
                requests table, then select <strong>Copy</strong> &gt;{' '}
                <strong>Save all [listed] as HAR (sanitized)</strong>.
              </li>
              <li>
                <strong>Sensitive Header Exclusion vs. Host/Path Caveat:</strong> Chrome&apos;s sanitized
                export excludes selected sensitive request headers (such as <code>Cookie</code> and{' '}
                <code>Authorization</code>). It does <em>not</em> remove query parameters, hostnames,
                or URL paths. HAR Inspector strips query parameters during in-memory normalization, but URL
                paths and hostnames remain visible in analysis.
              </li>
            </ol>
            <p className="modal-reference-note">
              Official Reference:{' '}
              <a
                href="https://developer.chrome.com/docs/devtools/network/reference/#save-as-har"
                target="_blank"
                rel="noreferrer noopener"
                className="modal-external-link"
              >
                Chrome DevTools Network Reference — Save as HAR (developer.chrome.com) 
              </a>
            </p>
          </section>

          
          <section className="modal-section">
            <h3 className="modal-section-title">2. Supported Limits in HAR Inspector</h3>
            <div className="modal-limits-grid">
              <div className="limit-item">
                <span className="limit-label">Maximum File Size</span>
                <span className="limit-value">
                  {RULE_THRESHOLDS.MAX_FILE_BYTES.toLocaleString()} bytes (10 MiB)
                </span>
                <small className="limit-note">Enforced before reading into memory</small>
              </div>
              <div className="limit-item">
                <span className="limit-label">Maximum Raw Entries</span>
                <span className="limit-value">
                  {RULE_THRESHOLDS.MAX_RAW_ENTRIES.toLocaleString()} requests
                </span>
                <small className="limit-note">Rejected before expensive normalization</small>
              </div>
              <div className="limit-item">
                <span className="limit-label">Accepted File Types</span>
                <span className="limit-value">.har, .json</span>
                <small className="limit-note">Chromium HAR 1.2 log format</small>
              </div>
              <div className="limit-item">
                <span className="limit-label">Execution Environment</span>
                <span className="limit-value">100% In-Browser Memory</span>
                <small className="limit-note">Zero network calls, zero server persistence</small>
              </div>
            </div>
          </section>

          
          <section className="modal-section modal-privacy-section">
            <h3 className="modal-section-title">
              <span aria-hidden="true"></span> Privacy &amp; limitations
            </h3>
            <p className="modal-text">
              <strong>Local Memory Protection:</strong> HAR Inspector runs 100% in browser memory and never
              uploads recordings to any remote server or database. During parsing, cookies, authorization
              headers, POST payloads, response bodies, and query parameter values are strictly stripped
              or replaced with <code>?query_omitted</code>.
            </p>
            <div className="modal-privacy-callout">
              <strong>Explicit Privacy Caveat:</strong> URL hostnames and paths (e.g.{' '}
              <code>/v1/orders/status</code> or <code>api.example.com</code>) are preserved for network
              investigation. Because paths may still contain sensitive identifiers, complete
              anonymization is not claimed. Sanitized export removes selected sensitive headers, not all
              sensitive data. Always inspect recordings before sharing.
            </div>
          </section>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="action-btn action-btn-primary"
            onClick={onClose}
            id="btn-modal-understand"
          >
            I Understand — Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};



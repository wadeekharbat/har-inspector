import React, { useState } from 'react';

interface DemoGuideProps {
  onNavigateToRequest: (targetRequestId: string, relatedRequestIds?: string[]) => void;
}

export const DemoGuide: React.FC<DemoGuideProps> = ({ onNavigateToRequest }) => {
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);

  return (
    <section className="demo-guide-card" aria-labelledby="guide-heading">
      <div className="demo-guide-header">
        <div className="demo-guide-title-group">
          <span className="demo-guide-badge">Guided Investigation</span>
          <h2 id="guide-heading" className="demo-guide-title">
            Synthetic Broken-Checkout Walkthrough
          </h2>
        </div>
        <p className="demo-guide-subtitle">
          This recording demonstrates a failing e-commerce checkout flow. Follow the 4 steps below
          to inspect the server failure, rapid polling, API latency, and heavy payload directly in the
          automated findings and request timeline.
        </p>
      </div>

      
      <div className="demo-guide-steps-grid" role="region" aria-label="Investigation Steps">
        
        <article className="demo-step-card step-card-error">
          <div className="step-card-header">
            <span className="step-number">Step 1</span>
            <span className="step-level-tag tag-error">HTTP 500 Error</span>
          </div>
          <h3 className="step-title">Payment API HTTP 500 Response</h3>
          <p className="step-desc">
            <code>POST https://api.example.com/v1/checkout/pay</code> returned HTTP 500. The HAR
            recorded a 202 ms wait for the response.
          </p>
          <button
            type="button"
            className="action-btn-small action-btn-danger"
            onClick={() => onNavigateToRequest('req-6')}
            id="btn-guide-step-1"
            aria-label="Inspect Payment Error req-6 in Explorer"
          >
            Inspect req-6 (HTTP 500) &rarr;
          </button>
        </article>

        
        <article className="demo-step-card step-card-warning">
          <div className="step-card-header">
            <span className="step-number">Step 2</span>
            <span className="step-level-tag tag-warning">Repeated GET</span>
          </div>
          <h3 className="step-title">Order Status Polling Loop</h3>
          <p className="step-desc">
            3 consecutive GET requests to <code>/v1/orders/status?query_omitted</code> fired within
            a 950 ms window (starts at 3,000 ms, 3,450 ms, and 3,950 ms).
          </p>
          <button
            type="button"
            className="action-btn-small action-btn-secondary"
            onClick={() => onNavigateToRequest('req-7', ['req-7', 'req-8', 'req-9'])}
            id="btn-guide-step-2"
            aria-label="Inspect Polling Loop req-7 through req-9 in Explorer"
          >
            Inspect req-7..9 (Polling) &rarr;
          </button>
        </article>

        
        <article className="demo-step-card step-card-warning">
          <div className="step-card-header">
            <span className="step-number">Step 3</span>
            <span className="step-level-tag tag-warning">Long Request</span>
          </div>
          <h3 className="step-title">Shipping Rates Latency</h3>
          <p className="step-desc">
            <code>POST https://api.example.com/v1/shipping/rates</code> took 1,420 ms to resolve
            (with a 1,410 ms recorded HAR wait phase), exceeding the 1,000 ms diagnostic heuristic threshold.
          </p>
          <button
            type="button"
            className="action-btn-small action-btn-secondary"
            onClick={() => onNavigateToRequest('req-5')}
            id="btn-guide-step-3"
            aria-label="Inspect Shipping Rates req-5 in Explorer"
          >
            Inspect req-5 (1,420 ms) &rarr;
          </button>
        </article>

        
        <article className="demo-step-card step-card-warning">
          <div className="step-card-header">
            <span className="step-number">Step 4</span>
            <span className="step-level-tag tag-warning">Large Body</span>
          </div>
          <h3 className="step-title">Hero Banner Image Size</h3>
          <p className="step-desc">
            <code>GET https://cdn.example.com/images/checkout-hero-banner.png</code> recorded a response
            bodySize of 1,258,291 bytes (1.20 MB), crossing the 1 MiB threshold.
          </p>
          <button
            type="button"
            className="action-btn-small action-btn-secondary"
            onClick={() => onNavigateToRequest('req-3')}
            id="btn-guide-step-4"
            aria-label="Inspect Hero Banner req-3 in Explorer"
          >
            Inspect req-3 (1.20 MB) &rarr;
          </button>
        </article>
      </div>

      
      <div className="demo-explanation-accordion">
        <button
          type="button"
          className="demo-explanation-toggle"
          onClick={() => setIsExplanationOpen((prev) => !prev)}
          aria-expanded={isExplanationOpen}
          aria-controls="demo-explanation-content"
          id="btn-toggle-demo-explanation"
        >
          <span className="toggle-icon" aria-hidden="true">
            {isExplanationOpen ? '▼' : ''}
          </span>
          <span className="toggle-label">
            Analysis Truth: What This Recording Shows vs. What It Cannot Prove
          </span>
        </button>

        {isExplanationOpen && (
          <div
            id="demo-explanation-content"
            className="demo-explanation-content"
            role="region"
            aria-label="Analysis Truth and Guardrails"
          >
            <div className="truth-grid">
              
              <div className="truth-column truth-shows">
                <h4 className="truth-column-title">
                  <span aria-hidden="true">✓</span> What The Recorded Data Shows
                </h4>
                <ul className="truth-list">
                  <li>
                    <strong>Recorded HTTP 500:</strong> The server returned an HTTP 500 status code header
                    on <code>POST /v1/checkout/pay</code> with a 202 ms recorded HAR wait phase.
                  </li>
                  <li>
                    <strong>Rapid Cadence:</strong> Three GET requests to the same order status endpoint
                    were transmitted in close succession (950 ms total start span).
                  </li>
                  <li>
                    <strong>Elapsed Time:</strong> The shipping calculation API took 1,420 ms total elapsed
                    time, with a 1,410 ms recorded HAR wait phase.
                  </li>
                  <li>
                    <strong>Recorded Body Size:</strong> The checkout hero image has an exporter-reported
                    <code>bodySize</code> of 1,258,291 bytes (1.20 MB).
                  </li>
                </ul>
              </div>

              
              <div className="truth-column truth-cannot-prove">
                <h4 className="truth-column-title">
                  <span aria-hidden="true">✕</span> What A HAR Recording Cannot Prove
                </h4>
                <ul className="truth-list">
                  <li>
                    <strong>Server Root Cause:</strong> An HTTP 500 status reflects an HTTP response header, not
                    conclusive proof of database deadlock, microservice crash, or unhandled backend code.
                  </li>
                  <li>
                    <strong>Intent vs. Redundancy:</strong> The repeated GET calls to order status may be a
                    deliberate client polling loop or retry strategy, not necessarily redundant or erroneous.
                  </li>
                  <li>
                    <strong>User Delay & Causality:</strong> A 1,420 ms network call or 1.2 MB image is an
                    investigation heuristic; it does not prove rendering was blocked or checkout was abandoned.
                  </li>
                  <li>
                    <strong>Transport vs. Exporter:</strong> Recorded <code>bodySize</code> reflects exporter
                    accounting, which may differ from over-the-wire TLS transfer bytes due to caching or compression.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

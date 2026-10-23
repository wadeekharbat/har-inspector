import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testFilesDir = path.resolve(__dirname, '..', 'test-files');

test.describe('HAR Inspector ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#btn-load-demo');
  });

  test('1. demo-to-finding-to-evidence: real finding card click with active filters auto-clears and reveals request', async ({
    page,
  }) => {
    // 1. Load synthetic checkout demo
    await page.click('#btn-load-demo');
    const summaryHeading = page.locator('#session-summary-heading');
    await expect(summaryHeading).toHaveText('Demo: Broken Checkout (Synthetic)');

    // 2. Apply a filter that HIDES req-6 (which is status 500): filter to 2xx Success
    const statusSelect = page.locator('#explorer-status');
    await statusSelect.selectOption('2xx');

    // Confirm req-6 is currently hidden from the explorer table
    await expect(page.locator('#request-row-req-6')).toHaveCount(0);

    // 3. In FindingsPanel, find HTTP error finding card and click its evidence button
    const findingCard = page.locator('#finding-card-finding-http-error-req-6');
    await expect(findingCard).toBeVisible();
    const revealBtn = page.locator('#btn-reveal-finding-http-error-req-6');
    await revealBtn.click();

    // 4. Assert active filters were cleared and filter reset notice banner is displayed
    const resetBanner = page.locator('.filter-reset-banner');
    await expect(resetBanner).toBeVisible();
    await expect(resetBanner).toContainText(
      'Active filters were cleared to reveal diagnostic evidence for req-6'
    );
    await expect(statusSelect).toHaveValue('all');

    // 5. Assert req-6 is revealed and selected in the table
    const selectedRow = page.locator('#request-row-req-6');
    await expect(selectedRow).toBeVisible();
    await expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRow).toContainText('POST');
    await expect(selectedRow).toContainText('/v1/checkout/pay');
    await expect(selectedRow).toContainText('500');

    // 6. Assert Selected Request Details panel displays correct status and timing evidence
    const detailPanel = page.locator('.request-details-panel');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel).toContainText('500');
    await expect(detailPanel).toContainText('202 ms');
  });

  test('2. cross-page finding evidence navigation: finding request on another page updates pagination', async ({
    page,
  }) => {
    // 1. Import 2,000-entry fixture (20 pages of 100 rows)
    const har2000Path = path.join(testFilesDir, '2000-entries.har');
    await page.locator('#har-file-input').setInputFiles(har2000Path);
    await expect(page.locator('#session-summary-heading')).toHaveText('2000-entries.har');

    // Verify initial pagination state is Page 1 of 20
    const pageIndicator = page.locator('.pagination-info');
    await expect(pageIndicator).toContainText('Page 1 of 20');
    await expect(page.locator('#request-row-req-0')).toBeVisible();
    // req-150 is on Page 2 (rows 100-199), not Page 1 (rows 0-99)
    await expect(page.locator('#request-row-req-150')).toHaveCount(0);

    // 2. Set an active filter (e.g. status 2xx) so req-150 (status 404 HTTP error) is hidden
    await page.locator('#explorer-status').selectOption('2xx');
    await expect(page.locator('#request-row-req-150')).toHaveCount(0);

    // 3. Click evidence button for finding-http-error-req-150 in FindingsPanel
    const revealBtn = page.locator('#btn-reveal-finding-http-error-req-150');
    await revealBtn.click();

    // 4. Assert filter was cleared, banner displayed, and pagination automatically moved to Page 2
    const resetBanner = page.locator('.filter-reset-banner');
    await expect(resetBanner).toBeVisible();
    await expect(resetBanner).toContainText(
      'Active filters were cleared to reveal diagnostic evidence for req-150'
    );
    await expect(pageIndicator).toContainText('Page 2 of 20');

    // 5. Assert req-150 is visible on Page 2 and selected
    const row150 = page.locator('#request-row-req-150');
    await expect(row150).toBeVisible();
    await expect(row150).toHaveAttribute('aria-selected', 'true');
    await expect(row150).toContainText('/v1/missing-endpoint-150');
    await expect(row150).toContainText('404');

    // 6. Assert details panel shows req-150 measurements
    const detailPanel = page.locator('.request-details-panel');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel).toContainText('req-150');
    await expect(detailPanel).toContainText('404');
  });

  test('3. demo-guide-step-navigation: walkthrough step highlights request and opens details', async ({
    page,
  }) => {
    await page.click('#btn-load-demo');
    await expect(page.locator('.demo-guide-card')).toBeVisible();

    // Click Step 1 in Demo Guide
    const step1Btn = page.locator('#btn-guide-step-1');
    await step1Btn.click();

    // Verify row selected
    const selectedRow = page.locator('#request-row-req-6');
    await expect(selectedRow).toBeVisible();
    await expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRow).toContainText('POST');
    await expect(selectedRow).toContainText('500');

    // Verify details panel
    const detailPanel = page.locator('.request-details-panel');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel).toContainText('202 ms');
  });

  test('4. real file import: import clean-session.har, verify 0 findings, verify guide hidden', async ({
    page,
  }) => {
    const cleanHarPath = path.join(testFilesDir, 'clean-session.har');
    await page.locator('#har-file-input').setInputFiles(cleanHarPath);

    // Verify session loaded
    const summaryHeading = page.locator('#session-summary-heading');
    await expect(summaryHeading).toHaveText('clean-session.har');

    // Verify Demo Guide is NOT rendered for imported file
    await expect(page.locator('.demo-guide-card')).toHaveCount(0);

    // Verify Clean Session Finding Result Card
    const cleanCard = page.locator('.findings-clean-card');
    await expect(cleanCard).toBeVisible();
    await expect(cleanCard).toContainText('No Configured Diagnostic Rules Matched');
    await expect(cleanCard).toContainText('Scope limitation:');
  });

  test('5. invalid replacement preserves good session: failed import retains previous recording', async ({
    page,
  }) => {
    // First, load clean demo session
    await page.click('#btn-load-clean-demo');
    const summaryHeading = page.locator('#session-summary-heading');
    await expect(summaryHeading).toContainText('Demo: Clean E-Commerce Catalog');

    // Attempt to upload an invalid file
    const malformedHarPath = path.join(testFilesDir, '2-malformed-secret.har');
    await page.locator('#har-file-input').setInputFiles(malformedHarPath);

    // Verify error banner appears
    const alertBanner = page.locator('.alert-banner');
    await expect(alertBanner).toBeVisible();
    await expect(alertBanner).toContainText('Import Failed');
    await expect(alertBanner).toContainText('Last-Good Session Preserved');

    // Verify previous clean session remains active in memory
    await expect(summaryHeading).toContainText('Demo: Clean E-Commerce Catalog');
    await expect(page.locator('.table-responsive-container')).toBeVisible();
  });

  test('6. reset: clears session and disables reset control', async ({ page }) => {
    await page.click('#btn-load-demo');
    await expect(page.locator('#session-summary-heading')).toBeVisible();

    const resetBtn = page.locator('#btn-reset-session');
    await expect(resetBtn).toBeEnabled();
    await resetBtn.click();

    await expect(page.locator('#session-summary-heading')).toHaveCount(0);
    await expect(page.locator('.explorer-card')).toHaveCount(0);
    await expect(resetBtn).toBeDisabled();

    const srAnnouncement = page.locator('.sr-only[aria-live="polite"]');
    await expect(srAnnouncement).toContainText('Session reset.');
  });

  test('7. sourceKind walkthrough gating: DemoGuide only displays for actual synthetic demo', async ({
    page,
  }) => {
    // 1. Synthetic checkout -> Guide visible
    await page.click('#btn-load-demo');
    await expect(page.locator('.demo-guide-card')).toBeVisible();

    // 2. Import file named "Broken Checkout.har" -> Guide MUST NOT appear
    const misleadingHarPath = path.join(testFilesDir, 'Broken Checkout.har');
    await page.locator('#har-file-input').setInputFiles(misleadingHarPath);
    await expect(page.locator('#session-summary-heading')).toHaveText('Broken Checkout.har');
    await expect(page.locator('.demo-guide-card')).toHaveCount(0);

    // 3. Clean demo -> Guide MUST NOT appear
    await page.click('#btn-load-clean-demo');
    await expect(page.locator('.demo-guide-card')).toHaveCount(0);

    // 4. Return to synthetic checkout demo -> Guide reappears
    await page.click('#btn-load-demo');
    await expect(page.locator('.demo-guide-card')).toBeVisible();
  });

  test('8. modal keyboard flow, Tab containment & focus restoration', async ({ page }) => {
    const helpBtn = page.locator('#btn-open-export-help');
    await helpBtn.focus();
    await helpBtn.click();

    const modal = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();

    const closeBtn = page.locator('#btn-close-export-help');
    await expect(closeBtn).toBeFocused();

    // Press Shift+Tab: ensure backwards wrap to last focusable element in modal
    const understandBtn = page.locator('#btn-modal-understand');
    await page.keyboard.press('Shift+Tab');
    await expect(understandBtn).toBeFocused();

    // Press Tab: wraps back to first element (Close button)
    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();

    // Press Escape: modal closes and focus is restored to opener button
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(helpBtn).toBeFocused();

    // Re-open and test close button click restoration
    await helpBtn.click();
    await expect(modal).toBeVisible();
    await closeBtn.click();
    await expect(modal).toHaveCount(0);
    await expect(helpBtn).toBeFocused();

    // Re-open and test footer "I Understand" button click restoration
    await helpBtn.click();
    await expect(modal).toBeVisible();
    await understandBtn.click();
    await expect(modal).toHaveCount(0);
    await expect(helpBtn).toBeFocused();
  });

  test('9. 2,000-entry performance in Chromium: import <= 2s and filter update <= 200ms', async ({
    page,
  }) => {
    const har2000Path = path.join(testFilesDir, '2000-entries.har');

    const t0 = await page.evaluate(() => performance.now());
    await page.locator('#har-file-input').setInputFiles(har2000Path);

    await page.waitForSelector('table.request-table tbody tr');
    const t1 = await page.evaluate(() => performance.now());
    const importElapsedMs = t1 - t0;

    console.log(`[Browser Performance] 2,000-entry import-to-usable in Chromium: ${importElapsedMs.toFixed(1)} ms`);
    expect(importElapsedMs).toBeLessThan(2000);

    await expect(page.locator('#session-summary-heading')).toHaveText('2000-entries.har');
    await expect(page.locator('.stat-box').first()).toContainText('2,000');

    const searchInput = page.locator('#explorer-search');
    const tFilterStart = await page.evaluate(() => performance.now());
    await searchInput.fill('reports');
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('table.request-table tbody tr');
      return rows.length > 0 && rows.length < 50;
    });
    const tFilterEnd = await page.evaluate(() => performance.now());
    const filterElapsedMs = tFilterEnd - tFilterStart;

    console.log(`[Browser Performance] 2,000-entry filter update in Chromium: ${filterElapsedMs.toFixed(1)} ms`);
    expect(filterElapsedMs).toBeLessThan(200);
  });

  test('10. privacy and security audit: zero external network traffic, zero secret leaks into DOM/logs, and zero persistence after reload', async ({
    page,
  }) => {
    // 1. Attach network and log monitoring BEFORE any navigation to capture all traffic
    const externalRequests: string[] = [];
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (
        new URL(url).origin !== new URL(process.env.APP_URL || 'http://127.0.0.1:5173').origin &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        externalRequests.push(url);
      }
    });

    page.on('console', (msg) => consoleLogs.push(msg.text()));
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 2. Navigate and import adversarial fixture
    await page.goto('/');
    const advHarPath = path.join(testFilesDir, 'adversarial-cases.har');
    await page.locator('#har-file-input').setInputFiles(advHarPath);
    await expect(page.locator('#session-summary-heading')).toHaveText('adversarial-cases.har');
    await expect(page.locator('.table-responsive-container')).toBeVisible();

    // 3. Before reset / reload: assert synthetic credential/query/header/body tokens absent from rendered DOM
    const renderedHtml = await page.content();

    // Password credentials from URL must not leak into DOM
    expect(renderedHtml).not.toContain('superSecretPass123!');
    expect(renderedHtml).not.toContain('admin:superSecretPass123!');
    // Bearer token from headers must not leak into DOM
    expect(renderedHtml).not.toContain('super-secret-token');
    // Cookie values must not leak into DOM
    expect(renderedHtml).not.toContain('secret-cookie-value');
    // Injected script tags must not be rendered as executable scripts or raw unescaped HTML
    expect(renderedHtml).not.toContain('<script>alert("XSS")</script>');
    expect(renderedHtml).not.toContain('<script>alert("status")</script>');
    expect(renderedHtml).not.toContain('<img src=x onerror=alert(1)>');
    // Raw query parameter values must not leak into DOM
    expect(renderedHtml).not.toContain('param=safe');
    expect(renderedHtml).not.toContain('filter=node');

    // Assert URL hostnames and sanitized paths ARE displayed honestly (never claimed as completely anonymized)
    expect(renderedHtml).toContain('security.example.com');
    expect(renderedHtml).toContain('api.example.com');
    expect(renderedHtml).toContain('?query_omitted');

    // 4. Assert secrets absent from console logs and zero runtime page errors
    const logsText = consoleLogs.join('\n');
    expect(logsText).not.toContain('superSecretPass123!');
    expect(logsText).not.toContain('super-secret-token');
    expect(logsText).not.toContain('secret-cookie-value');
    expect(pageErrors).toHaveLength(0);

    // 5. Reload page while imported session is active (WITHOUT clicking reset)
    await page.reload();
    await page.waitForSelector('#btn-load-demo');

    // Assert imported summary, findings, and explorer are completely discarded on reload
    await expect(page.locator('#session-summary-heading')).toHaveCount(0);
    await expect(page.locator('.explorer-card')).toHaveCount(0);
    await expect(page.locator('.findings-section')).toHaveCount(0);
    await expect(page.locator('#btn-reset-session')).toBeDisabled();

    // 6. Check storage mechanisms in browser: localStorage, sessionStorage, IndexedDB, and Service Workers
    const storageAudit = await page.evaluate(async () => {
      let dbCount = 0;
      if (window.indexedDB && window.indexedDB.databases) {
        const dbs = await window.indexedDB.databases();
        dbCount = dbs.length;
      }
      let swCount = 0;
      if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        swCount = regs.length;
      }
      return {
        localStorageLength: window.localStorage.length,
        sessionStorageLength: window.sessionStorage.length,
        indexedDBDatabasesCount: dbCount,
        serviceWorkerRegistrationsCount: swCount,
      };
    });

    expect(storageAudit.localStorageLength).toBe(0);
    expect(storageAudit.sessionStorageLength).toBe(0);
    expect(storageAudit.indexedDBDatabasesCount).toBe(0);
    expect(storageAudit.serviceWorkerRegistrationsCount).toBe(0);

    // 7. Assert zero external network traffic was made throughout
    expect(externalRequests).toHaveLength(0);
  });

  test('11. responsive mobile checks: visible reachable controls, table horizontal scroll, usable details and help dialog', async ({
    page,
  }) => {
    // Set mobile viewport (375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.click('#btn-load-demo');

    // 1. Verify reachable, visible primary controls on mobile
    const loadDemoBtn = page.locator('#btn-load-demo');
    const cleanDemoBtn = page.locator('#btn-load-clean-demo');
    const helpBtn = page.locator('#btn-open-export-help');
    const resetBtn = page.locator('#btn-reset-session');

    await expect(loadDemoBtn).toBeVisible();
    await expect(cleanDemoBtn).toBeVisible();
    await expect(helpBtn).toBeVisible();
    await expect(resetBtn).toBeVisible();

    const buttonsInBounds = await page.evaluate(() => {
      const btns = [
        document.getElementById('btn-load-demo'),
        document.getElementById('btn-load-clean-demo'),
        document.getElementById('btn-open-export-help'),
        document.getElementById('btn-reset-session'),
      ];
      return btns.every((b) => {
        if (!b) return false;
        const r = b.getBoundingClientRect();
        return r.left >= 0 && r.right <= window.innerWidth + 1;
      });
    });
    expect(buttonsInBounds).toBe(true);

    // 2. Verify internal table horizontal scrolling without root page scroll
    const tableContainer = page.locator('.table-responsive-container');
    await expect(tableContainer).toBeVisible();

    const scrollMetrics = await page.evaluate(() => {
      const container = document.querySelector('.table-responsive-container') as HTMLElement;
      const table = document.querySelector('.request-table') as HTMLElement;
      return {
        containerClientWidth: container?.clientWidth ?? 0,
        tableScrollWidth: table?.scrollWidth ?? 0,
        hasHorizontalScroll: (table?.scrollWidth ?? 0) > (container?.clientWidth ?? 0),
      };
    });
    expect(scrollMetrics.hasHorizontalScroll).toBe(true);
    expect(scrollMetrics.containerClientWidth).toBeLessThanOrEqual(375);

    // Test scrolling internal table container horizontally
    await page.evaluate(() => {
      const container = document.querySelector('.table-responsive-container');
      if (container) container.scrollLeft = 200;
    });
    const scrolledLeft = await page.evaluate(() => {
      return document.querySelector('.table-responsive-container')?.scrollLeft ?? 0;
    });
    expect(scrolledLeft).toBeGreaterThan(0);

    // 3. Verify Selected Request Details panel is usable and reachable on mobile
    const row0 = page.locator('#request-row-req-0');
    await row0.click();

    const detailsPanel = page.locator('.request-details-panel');
    await expect(detailsPanel).toBeVisible();

    const detailsInBounds = await page.evaluate(() => {
      const panel = document.querySelector('.request-details-panel');
      if (!panel) return false;
      const r = panel.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth + 1;
    });
    expect(detailsInBounds).toBe(true);

    // Close details
    const closeDetailsBtn = page.locator('#btn-close-details');
    await closeDetailsBtn.click();
    await expect(detailsPanel).toHaveCount(0);

    // 4. Verify Export Help dialog on mobile
    await helpBtn.click();
    const modalDialog = page.locator('.modal-dialog');
    await expect(modalDialog).toBeVisible();

    const modalInBounds = await page.evaluate(() => {
      const dlg = document.querySelector('.modal-dialog');
      if (!dlg) return false;
      const r = dlg.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth + 1;
    });
    expect(modalInBounds).toBe(true);

    const understandBtn = page.locator('#btn-modal-understand');
    await expect(understandBtn).toBeVisible();
    await understandBtn.click();
    await expect(modalDialog).toHaveCount(0);
  });
});


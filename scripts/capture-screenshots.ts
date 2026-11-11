import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, '..', 'docs', 'screenshots');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function capture() {
  console.log('Launching Chromium for screenshot capture...');
  const browser = await chromium.launch();

  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await desktopContext.newPage();

  console.log('Capturing 01-landing-empty-state.png...');
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173/');
  await page.waitForSelector('#btn-load-demo');
  await page.screenshot({
    path: path.join(outputDir, '01-landing-empty-state.png'),
    fullPage: false,
  });

  console.log('Capturing 02-synthetic-checkout-overview.png...');
  await page.click('#btn-load-demo');
  await page.waitForSelector('#session-summary-heading');
  await page.waitForSelector('.findings-list');
  await page.locator('.session-summary-card').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(outputDir, '02-synthetic-checkout-overview.png'),
    fullPage: false,
  });

  console.log('Capturing 03-finding-evidence-revealed.png...');
  await page.locator('#explorer-status').selectOption('2xx');
  await page.click('#btn-reveal-finding-http-error-req-6');
  await page.waitForSelector('.filter-reset-banner');
  await page.waitForSelector('.request-details-panel');
  await page.locator('.request-details-panel').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(outputDir, '03-finding-evidence-revealed.png'),
    fullPage: false,
  });

  console.log('Capturing 04-clean-session.png...');
  await page.click('#btn-load-clean-demo');
  await page.waitForSelector('#session-summary-heading');
  await page.waitForSelector('.findings-clean-card');
  await page.locator('.findings-clean-card').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(outputDir, '04-clean-session.png'),
    fullPage: false,
  });

  console.log('Capturing 05-export-help-modal.png...');
  await page.click('#btn-open-export-help');
  await page.waitForSelector('#export-help-title');
  await page.screenshot({
    path: path.join(outputDir, '05-export-help-modal.png'),
    fullPage: false,
  });

  await desktopContext.close();

  console.log('Capturing 06-mobile-responsive.png...');
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(process.env.APP_URL || 'http://127.0.0.1:5173/');
  await mobilePage.waitForSelector('#btn-load-demo');
  await mobilePage.click('#btn-load-demo');
  await mobilePage.waitForSelector('#session-summary-heading');
  await mobilePage.locator('.session-summary-card').scrollIntoViewIfNeeded();
  await mobilePage.screenshot({
    path: path.join(outputDir, '06-mobile-responsive.png'),
    fullPage: false,
  });

  await mobileContext.close();
  await browser.close();
  console.log('All screenshots captured successfully in docs/screenshots!');
}

capture().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});



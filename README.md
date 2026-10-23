# HAR Inspector

A local browser dashboard for investigating HTTP Archive (HAR) recordings. Find failed requests, slow responses, large bodies, and repeated GET calls, then inspect the recorded evidence in a request table and waterfall.

![HAR Inspector dashboard](docs/screenshots/02-synthetic-checkout-overview.png)

## Run locally

Install Node.js 24 or newer and npm. Download this repository using **Code → Download ZIP** and extract it, or clone it with Git. Open a terminal in the extracted project folder (the folder containing `package.json`), then run:

```sh
npm ci
npm run dev
```

Open the local address printed in the terminal (usually `http://localhost:5173`). Keep the terminal running; press Ctrl+C to stop it. No account, API key, or backend is required. Installing dependencies requires internet access. HAR processing happens locally in the browser.

This repository contains the web app's source code. GitHub's file preview does not run the app, and no hosted demo is provided.

## Investigate a recording

1. Load **Broken Checkout** to explore a synthetic example, or import your own `.har` or HAR-formatted `.json` file.
2. Review the request totals and diagnostic findings.
3. Select a finding's evidence action to locate the relevant request. Conflicting table filters are cleared automatically.
4. Inspect status, duration, size, and phase timings. Use search, filters, sorting, and pagination to narrow the request list.
5. Reset the session to clear the active recording.

The clean example demonstrates a recording without matching diagnostic rules. It is not proof that a system is healthy. Export guidance is available inside the dashboard.

## Privacy and limits

Imports are held in memory. The app does not upload recordings, replay requests, fetch recorded URLs, or save sessions to browser storage. Reloading clears the session.

The normalized model excludes headers, cookies, request bodies, response content, embedded URL credentials, fragments, and query parameter values. **Hostnames and URL paths can still contain sensitive data.** Sanitization is not complete anonymization. Use synthetic or reviewed sanitized recordings when reporting issues; never attach private captures or screenshots containing confidential paths.

- Maximum file size: 10 MiB.
- Maximum raw entries: 2,000, before invalid entries are filtered.
- One recording at a time; no live capture or session comparison.
- Chromium is verified. Firefox and Safari/WebKit remain unverified.

## Diagnostic rules

| Rule | Recorded trigger |
|---|---|
| HTTP error | Status 400–599 |
| Missing HTTP status | Status 0 |
| Long request | Duration at least 1,000 ms |
| Large body | Recorded `response.bodySize` at least 1 MiB |
| Repeated GET | At least three GET calls to the same endpoint within 2,000 ms |

Findings describe recorded conditions, not root causes. Missing timings and sizes remain unknown rather than being treated as zero. Thresholds are defined in `src/domain/types.ts`.

## Development

React, TypeScript, Vite, and plain CSS. Parsing, exploration, and diagnostics live in `src/domain/`; UI components live in `src/components/`. Bundled recordings and generated test captures are synthetic.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The recorded suite contains 135 unit tests and 11 Chromium browser tests. Browser checks cover imports, evidence navigation, filters, keyboard handling, mobile layout, privacy behavior, and a 2,000-entry recording. Results depend on the local environment; no universal performance guarantee is made.

For a local production preview, run `npm run build` then `npm run preview`. Build output is written to `dist/`.

Additional commands:

```sh
npm run fixtures:generate
npm run screenshots:capture
```

Browser test captures are generated automatically before `npm run test:e2e`; the generated `test-files/` directory is excluded from Git. Screenshot capture requires the development server at `http://127.0.0.1:5173`. Set `APP_URL` to use a different preview address.

## Screenshots

| Request evidence | Mobile layout |
|---|---|
| ![Request evidence](docs/screenshots/03-finding-evidence-revealed.png) | ![Mobile dashboard](docs/screenshots/06-mobile-responsive.png) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for issue reports and pull requests. Contributions to the official repository are reviewed by its maintainer.

## License

[MIT](LICENSE). Copyright 2026 Wadee.

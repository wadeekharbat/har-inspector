# Contributing

For a bug report, include the expected and observed behavior, browser version, reproduction steps, and terminal output if relevant. Use a minimal synthetic HAR example. Do not attach real customer recordings, credentials, private hostnames, or sensitive URL paths.

For changes, fork the repository, create a branch, and keep the pull request focused. Explain the behavior changed and checks run. Run `npm run typecheck`, `npm test`, and `npm run build`; run `npm run test:e2e` for changes affecting user interaction. Install Chromium first with `npx playwright install chromium`.

Preserve import limits, local processing, sanitization, and unknown-value handling. Add tests when fixing behavior that could regress. Avoid unnecessary dependencies. Pull requests are reviewed before merging.

Do not post an exploitable security issue with sensitive details publicly. Use GitHub private vulnerability reporting if the repository offers it; otherwise open an issue requesting a private contact channel without disclosing exploit details or real data.

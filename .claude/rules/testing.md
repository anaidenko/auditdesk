---
description: How tests are written and run in this repository
paths:
    - e2e/**
    - "**/*.test.ts"
    - "**/*.test.tsx"
    - playwright.config.ts
    - vitest.config.mts
---

# Testing

- **Unit tests (Vitest)** sit next to the code as `*.test.ts` and run in Node against the
  `auditdesk_test` database (`.env.test`; `pnpm db:up` first). Files run one after another,
  since they share that database.
- **The model is replayed, never called.** `src/engine/replay.ts` serves recorded messages as a
  server-sent-event stream through the client's injected `fetch`, so the SDK's tool runner and
  stream parser are under test and no test calls the API.
- **The scanners are replayed too:** recorded outputs in `src/test/fixtures/scanners/`, so no
  test needs the scanner images.
- **The own fixture's key tests clone it from GitHub.** Offline, rewrite its URL to a local clone
  through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` (README § Tests): an
  `insteadOf` in this repository's config does not reach a clone made inside it.
- **End-to-end tests (Playwright)** run the built app on port 3100 with both replays.
- **A socket a test server hands over** in a `connect` or `upgrade` event needs its own error
  listener: Linux resets it where macOS closes it, and the uncaught `ECONNRESET` fails CI only.
- **A test that passes before the change exists** is a finding about the test. A red run counts
  only when its message shows the failure under test.
- **Read `Test Files` as well as `Tests`.** A file that fails to load (a YAML parse error, a bad
  import) fails no test, so a filtered `Tests  N passed` line hides it.

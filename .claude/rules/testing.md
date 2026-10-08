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

- **Unit tests (Vitest)** sit next to the code as `*.test.ts` and run in Node, in two projects
  (`vitest.config.mts`). `db` holds `src/server/**` and the route tests: they share the
  `auditdesk_test` database (`.env.test`; `pnpm db:up` first), so its files run one after
  another, after the rest. `unit` holds everything else and runs in parallel; a `unit` file
  that touches `prisma` fails (`src/test/no-db.ts`), so move it under a `db` glob. A run of
  `unit` files alone needs no database.
- **The model is replayed, never called.** `src/engine/replay.ts` serves recorded messages as a
  server-sent-event stream through the client's injected `fetch`, so the SDK's tool runner and
  stream parser are under test and no test calls the API.
- **The scanners are replayed too:** recorded outputs in `src/test/fixtures/scanners/`, so no
  test needs the scanner images.
- **The own fixture's key tests clone it from GitHub.** Offline, rewrite its URL to a local clone
  through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` (README § Tests): an
  `insteadOf` in this repository's config does not reach a clone made inside it.
- **End-to-end tests (Playwright)** run the built app on port 3100 with both replays.
- **After a click that navigates, `await page.waitForURL(…)` before reading `page.url()`:** a
  `<Link>` click returns before the navigation, and the URL is still the old page's. A click that
  posts a Server Action returns before its answer too: wait for the POST's response (its
  `next-action` header) before a reload, or the reload renders what the action replaced.
- **A worktree for unit tests:** `scripts/worktree.sh <branch> <dir>` links `node_modules`,
  generates the Prisma client, which a bare `git worktree add` leaves out (type checks then fail
  with implicit `any` everywhere), and points `.env.test.local` at the worktree's own test
  database: `global-setup` drops the database with `FORCE`, so a shared one fails a parallel
  session's run.
- **e2e in a worktree:** replace the linked `node_modules` with an install
  (`rm node_modules && DATABASE_URL=… pnpm install --frozen-lockfile --offline`; the postinstall
  generates the client), then run with `E2E_DATABASE_URL` naming a database of its own. Port 3100
  stays shared: one e2e run at a time. A server started to look at a branch (`next dev` on another
  port) runs the job runner too: point it at a database no test or session uses, and stop it
  before an e2e run, or it takes the e2e's jobs.
- **A socket a test server hands over** in a `connect` or `upgrade` event needs its own error
  listener: Linux resets it where macOS closes it, and the uncaught `ECONNRESET` fails CI only.
- **A test that passes before the change exists** is a finding about the test. A red run counts
  only when its message shows the failure under test.
- **Read `Test Files` as well as `Tests`.** A file that fails to load (a YAML parse error, a bad
  import) fails no test, so a filtered `Tests  N passed` line hides it.

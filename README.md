# Auditdesk

A local web app for auditing a client's codebase: it clones the repositories, runs
deterministic scanners, has Claude investigate each chosen aspect with read-only tools, lets the
auditor accept, edit or reject every finding, and exports a client-ready report.

Local only: binds 127.0.0.1, no login.

## Setup

```bash
cp .env.example .env.local
pnpm install
pnpm db:up
pnpm db:deploy
pnpm dev
git config core.hooksPath .githooks
```

## Live check

`pnpm tsx scripts/smoke.mts` sends two small requests with the agent's exact request shape and
prints each response's model, stop reason and usage. It needs `ANTHROPIC_API_KEY` in
`.env.local` and costs a few cents.

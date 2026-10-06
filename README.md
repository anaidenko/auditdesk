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

## Model access

Each project runs on one of two engines, chosen under "Model access" on its page:

- **Claude plan** (default): the Claude Agent SDK on your Claude subscription. Run
  `claude setup-token`, then put the token in `.env.local` as `CLAUDE_CODE_OAUTH_TOKEN` or save
  it in Settings. Usage counts against your plan's limits; the run page shows API-equivalent
  dollars, not a bill.
- **API key**: the Messages API, billed per token under the Commercial Terms. Put the key in
  `.env.local` as `ANTHROPIC_API_KEY` or save it in Settings.

A value in `.env.local` wins over a saved one. Saved values live in
`~/.auditdesk/credentials.json` (mode 0600), never in the database. The Agent SDK session gets
the app's seven read-only tools and nothing else: no built-in tools, no settings, hooks, skills
or MCP servers from the clone or from `~/.claude`.

A Claude plan run keeps half of the plan's 5-hour window in reserve. The engine saves the last
reading the plan reports to `~/.auditdesk/plan-usage.json`; above 50% a run starts only with
"Allow past the 50% reserve" ticked, and a run that crosses 50% stops after that turn. A call
paid by extra usage stops the agent in any case.

## Live check

`pnpm tsx scripts/smoke.mts` sends two small requests with the agent's exact request shape and
prints each response's model, stop reason and usage. It needs `ANTHROPIC_API_KEY` in
`.env.local` and costs a few cents.

`pnpm tsx scripts/smoke-sdk.mts` sends one aspect agent through the SDK engine on the plan token
and prints its outcome, its calls and the plan's 5-hour usage.

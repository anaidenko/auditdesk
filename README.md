# Auditdesk

A local web app for auditing a client's codebase. It clones the repositories, runs
deterministic scanners, has Claude investigate each chosen aspect with read-only tools, lets the
auditor accept, edit or reject every finding, and exports a client-ready report as HTML and PDF.

Local only: it binds 127.0.0.1 and has no login. The design is in [docs/design.md](docs/design.md).

![A project: a repository with its detected stack, and the run form with its aspects, model, caps and estimate](docs/screenshots/project.png)

## What it does

- **Scanners first:** gitleaks over the history of every branch cloned, osv-scanner over the lock files and
  Semgrep, in pinned Docker images and on the app's own configuration. Every secret gitleaks
  finds is masked in everything the model or the client sees.
- **One agent per aspect:** security always, plus dependencies, architecture, data model, code
  quality and tests, production readiness, API design, performance, accessibility, LLM
  integrations and multi-tenancy as chosen. Each
  works from a checklist with stable item IDs and reads the code through read-only tools. With
  several repositories, a seams pass reads them together: the front end's calls against the
  back end's routes, auth across both, CORS, validation only on the client, secrets in the bundle.
- **Stack detection** from manifests and schemas, confirmed or edited by the auditor, suggests
  the conditional aspects; an AI-built mode adds checks for code written largely by AI tools.
- **Review:** accept, edit, merge, reject or exclude every finding; only accepted or edited ones
  reach the report and the exports, and the export buttons say how many still await review.
  A scanner finding that an agent filed again is folded into the agent's, and
  results in test, fixture, seed or example files are rated lower and say so. IDs (`F-012`) are never reused, and a reviewed finding keeps its ID through
  re-runs.
- **Re-audit:** a run on the client's later commit re-checks each reported finding: a dependency
  or Semgrep result that is gone is fixed, cited code that is still there reads "code unchanged",
  code that moved on is for the auditor to verify, and a fix that comes back is regressed. The
  report opens with what changed since the last audit.
- **The report:** one self-contained HTML file with filters and search, and a PDF. A summary of
  what to fix before sign-off and what can wait, scope and method (the steps that ran, what the
  review made of the findings, each aspect's coverage), each finding with its
  recommendation in view and its details and evidence a click away (Expand all opens every card;
  print and the PDF show them all), and links to the OWASP Top 10:2025, ASVS 5.0.0, CWE, Cheat
  Sheets and WCAG 2.2 it is relevant to. A repository cloned from GitHub, GitLab or Bitbucket links
  to itself, its branch and its commit; a local one does not.
- **Exports:** besides the report, SARIF 2.1.0 for code scanning, one file per repository, and the
  accepted findings as issue drafts: a CSV for Linear's CLI importer ("Linear (CSV)") or another
  tracker's, or JSON that `pnpm issues:gh` turns into GitHub issues through the `gh` CLI. It
  previews them first; `--create` creates them, skips those that exist, and refuses a public
  repository without `--public`. To upload the SARIF to GitHub, run `github/codeql-action/upload-sarif`
  after a checkout of the audited commit, so GitHub can compute its own fingerprints.
- **Cost under control:** caps per run, split between agents; a pre-run estimate from past runs;
  every call priced by the model that served it.

![Review: each finding with its evidence and the auditor's decision](docs/screenshots/findings.png)

![Findings in the report: the first card open on its details, evidence with line numbers and references; the next collapsed to its title and recommendation](docs/screenshots/report-finding.png)

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, PostgreSQL through Prisma 7, the
Anthropic SDK and the Claude Agent SDK, Playwright for the PDF and end-to-end tests, Vitest.

- **Next.js:** Server Components reading through a server-only data layer; every mutation a
  Server Action, and the forms that can be refused report back through `useActionState`; Route Handlers for downloads and Server-Sent Events;
  `proxy.ts` as a Host allowlist; `instrumentation.ts` starting the job runner.
- **PostgreSQL:** a job queue claimed with `FOR UPDATE SKIP LOCKED`; live progress through
  `LISTEN`/`NOTIFY`; JSONB evidence; full-text search over findings; partial indexes, one of them
  unique so a double click cannot start two runs.

## Setup

You need Node 22 or later, pnpm 10 (through Corepack), Docker, and for Claude plan access the
`claude` CLI.

```bash
cp .env.example .env.local
pnpm install
pnpm exec playwright install chromium
git config core.hooksPath .githooks
pnpm db:up
pnpm db:deploy
pnpm dev
```

`pnpm app start --wait` runs the app in the background instead (`stop`, `restart`, `status`,
`logs`; `--prod` builds and runs `next start`): `scripts/dev-server.sh` keeps its process group,
log and pid under `logs/`, takes the port from `.dev-port` (default 3000), and refuses to stop
while a job runs, since that would mark the job interrupted.

Set `AUDITOR_NAME` in `.env.local`: it is the name on the report's cover, and without it the
report names no auditor. `AUDITOR_URL` links that name, and `AUDIT_METHOD_URL` is linked from
Scope and method as the method in full; both are optional. The PDF export prints through the Chromium that Playwright installs.
Docker runs PostgreSQL and the scanners. The app opens at http://127.0.0.1:3000.

## Model access

Each project runs on one of two engines, chosen under "Model access" on its page. A new project
starts on the Claude plan.

- **API key:** the Messages API, billed per token under Anthropic's Commercial Terms. Put the key
  in `.env.local` as `ANTHROPIC_API_KEY` or save it in Settings.
- **Claude plan:** the Claude Agent SDK on your own Claude subscription, for your own audits. Run
  `claude setup-token`, then put the token in `.env.local` as `CLAUDE_CODE_OAUTH_TOKEN` or save it
  in Settings. Usage counts against your plan's limits; the run page shows API-equivalent
  dollars, not a bill.

A value in `.env.local` wins over a saved one. Saved values live in
`~/.auditdesk/credentials.json` (mode 0600), never in the database. The Agent SDK session gets
the app's seven tools (five read the clone, two file findings and coverage) and nothing else: no
built-in tools, no settings, hooks, skills or MCP servers from the clone or from `~/.claude`.

A Claude plan run keeps half of the plan's 5-hour window in reserve. The engine saves the last
reading the plan reports to `~/.auditdesk/plan-usage.json`; above 50% a run starts only with
"Allow past the 50% reserve" ticked, and a run that crosses 50% stops after that turn. A call
paid by extra usage stops the agent in any case.

![A finished run: its spend per serving model and the agents' activity](docs/screenshots/run.png)

## Tests

```bash
pnpm test        # Vitest: logic; the files under src/server and the routes share a test database
pnpm test:e2e    # Playwright: the built app, with the model and the scanners replayed
```

Neither calls the API: recorded model responses and scanner outputs are replayed, so CI needs no
key and no scanner images. The database files run one after another, after the rest run in
parallel; a run of other files alone (`pnpm vitest run src/engine`) needs no database.
`AUDITDESK_SCREENSHOTS=1 pnpm test:e2e -g screenshots` retakes the screenshots above from a
replayed run on a sample repository. `pnpm test` clones the own fixture from GitHub to check its
answer key; offline, point the URL at a local clone with
`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.<path>.insteadOf GIT_CONFIG_VALUE_0=https://github.com/anaidenko/auditdesk-fixture`
(a repository's own `insteadOf` does not reach a clone made inside it).

## Evals

`pnpm eval` audits a fixture prepared at a pinned commit, without the server, and scores the
findings against the fixture's answer key: recall (and the agents' share of it), findings outside
the key, cost by serving model, and what pins the result (both commits, the scanner digests, the
Semgrep rule hashes, the Auditdesk commit). Grading is deterministic on file, lines and checklist
item; with `--judge`, an LLM judge reads what the grader could not place, within a cap of its own.

- **Auditdesk's own fixture,** a small Next.js storefront platform with defects planted for every
  aspect, is a repository of its own,
  [anaidenko/auditdesk-fixture](https://github.com/anaidenko/auditdesk-fixture); its answer key is
  in `evals/answers/`, and the unit tests clone the fixture to check every entry at the pinned
  commit.
- **OWASP Juice Shop** v20.2.0, for comparison: the prep removes its coding challenges' answers
  (fixes, tutorials, translated hints, specs, the code that scores a solve) and renames every
  challenge, and `pnpm eval:key` reads its key from the markers.

`--matrix claude-sonnet-5-5:low,claude-opus-5-5:medium` runs several model and effort pairs one
after another, each with the whole budget; it names the total cap first, checks the plan's reserve
before each pair, and stops when an audit fails. The **Evals** page plots every result's recall
against its cost, one chart per fixture and aspect set, and marks a run that did not finish.

The security aspect alone, by model and effort, on 2026-10-07 (`evals/results/`): key entries
found, with the scanners' finds included and the agents' own in brackets, and the run's cost at
API prices.

| Model and effort | Own fixture, 8 entries | Juice Shop, 18 entries |
| --- | --- | --- |
| Sonnet 5.5, `low` | 5 (5), $0.17 | 2 (0), $0.12 |
| Sonnet 5.5, `medium` | 6 (6), $0.21 | 2 (0), $0.07 |
| Sonnet 5.5, `high` | 6 (6), $0.27 | 9 (7), $1.80 |
| Opus 5.5, `medium` | 7 (7), $0.75 | 6 (4), $2.59 |

All eight runs are of one Auditdesk commit (`0f36ca8`); the earlier Sonnet `low` result in the same
folder ($0.06) predates sending back an agent that looked at little. The own fixture was then at
`2aff7d0`; its key has grown since, with the aspects added after.

All eleven aspects on the own fixture, at Sonnet 5.5 `high` with an $11 and 550,000-token cap
(2026-10-07, fixture at `32aee95`): 28 of its 38 key entries found, all by the agents, with 4
findings outside the key, for $2.31 in 14 minutes. The eight-aspect run before it found 18 of the
then 25 entries for $1.55. The run's Auditdesk commit (`966b7a8`) adds Semgrep grouping to the
scanners; the agents, prompts and checklists are those of `main`.

## Live checks

`pnpm tsx scripts/smoke.mts` sends two small requests with the agent's exact request shape and
prints each response's model, stop reason and usage. It needs `ANTHROPIC_API_KEY` in
`.env.local` and costs a few cents.

`pnpm tsx scripts/smoke-sdk.mts` sends one aspect agent through the SDK engine on the plan token
and prints its outcome, its calls and the plan's 5-hour usage.

## Security of the tool

Bound to 127.0.0.1 with no login. `proxy.ts` allows only a `Host` of localhost or 127.0.0.1, which
stops DNS rebinding; every mutation is a Server Action, which Next.js accepts only by POST from
its own origin; Route Handlers are GET only and change no data (a report download keeps a copy
beside the clones, and refuses a request another site started); PostgreSQL is published on
127.0.0.1 only. The client's code is never installed, built or run, and a pre-commit hook runs
gitleaks on the staged files.

## Author

Built by Andrii Naidenko. For an audit of your codebase, get in touch through
[naidenko.dev](https://naidenko.dev).

## License

PolyForm Noncommercial 1.0.0 ([LICENSE.md](LICENSE.md)): free for noncommercial use. Commercial use,
including use inside a company or for paid client work, needs a separate licence: get in touch
through [naidenko.dev](https://naidenko.dev).

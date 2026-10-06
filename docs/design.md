# Auditdesk: design

Auditdesk is a local web app for auditing a client's codebase. It clones the repositories, runs
deterministic scanners, has Claude investigate each chosen aspect with read-only tools, lets the
auditor accept, edit or reject every finding, and exports a client-ready report as HTML and PDF.
An eval measures how many known defects the agents find, at what cost.

It is not a pull-request reviewer for a team's daily flow. It is a workbench for an engagement:
a few repositories, a brief from the client, a report a founder can read and engineers can act
on, signed off finding by finding by a human auditor.

## Principles

- **The deliverable is the product:** plain-language findings ranked by severity, with stable
  IDs, evidence, a recommendation, an effort, and links to the standards they are relevant to.
- **Local first:** the client's code stays on the auditor's machine. The model sees only the
  files the agent reads, with secrets masked. osv-scanner sends dependency names and versions to
  the OSV API; nothing else leaves the machine.
- **The client's code is data:** nothing from a repository is installed, built or run, and text
  in it that tries to instruct the model is itself a finding.
- **A human signs off:** only findings the auditor accepted or edited reach the report.
- **Measured:** every model call is priced by the model that served it, and an eval scores recall
  on fixtures with known defects.

## Architecture

```
Next.js 16 app, one process, bound to 127.0.0.1
  Server Components read through a server-only data layer (Prisma 7, PostgreSQL)
  Server Actions: every mutation          Route Handlers: GET only (SSE progress, downloads)
  proxy.ts: Host allowlist                instrumentation.ts: starts the job runner
        │
PostgreSQL ── jobs claimed with FOR UPDATE SKIP LOCKED; progress woken by LISTEN/NOTIFY
        │
engine (imports nothing from Next.js): workspace, scanners, masker, repository map,
  stack detection, aspect agents and their tools, report renderer, PDF
```

- **One process.** A Server Action writes a job; a runner started from `instrumentation.ts`
  claims jobs one at a time. The UI and the runner talk only through PostgreSQL, so the runner
  could move to its own process without a rewrite.
- **Progress** is written to the database and announced with `NOTIFY` in the same transaction;
  an SSE Route Handler `LISTEN`s, re-reads the run's state on each notification and on a timer,
  and streams it. A missed notification costs nothing.
- **Restarts:** jobs left running or queued are marked interrupted on startup and re-run only by
  hand, so a job that crashes the process cannot loop and keep spending.

## The pipeline

1. **Intake.** A project holds one or more repositories, each a git URL or a local path, cloned
   in full into a workspace outside the app's tree (a local path is cloned too, so uncommitted
   edits cannot make the recorded commit false). The auditor writes a brief and per-repository
   instructions and records the client's consent to an AI review.
2. **Scanners,** in pinned Docker images and on the app's own configuration, never the client's
   ignore files: gitleaks over every branch's history, osv-scanner over the lock files, Semgrep
   with named rulesets. Their results become findings, and gitleaks' secrets feed the masker.
   Every repository is scanned before any agent starts, so the brief, which every agent reads,
   is masked with the secrets of all of them.
3. **Stack detection** reads manifests, Prisma schemas and SQL migrations as text, never the
   code: languages, frameworks, databases, ORMs, authentication, LLM SDKs, tenancy keys and
   signs of AI-assisted development. The auditor confirms or edits the profile; it suggests the
   conditional aspects, and a language outside the audit's coverage is reported as not covered.
4. **Repository map:** the file tree with sizes, entry points, routes, the data schema,
   environment variables and the test layout, so agents start oriented.
5. **Aspect agents,** one per aspect and repository, one after another, security first.

## Aspects

Security is always on; the others are ticked per audit.

| Aspect | Covers |
|---|---|
| Security | authentication, sessions, authorization on every route, injection, XSS, CSRF and CORS, SSRF, uploads, validation, secrets, headers, rate limits, logging of secrets, crypto |
| Dependencies and supply chain | vulnerable packages that ship, lock files, versions, abandoned packages, install scripts, registries |
| Architecture and structure | layering, coupling, error handling, configuration, state, long work, contracts, use of the framework |
| Data model and database | constraints, indexes, N+1, transactions and concurrency, migrations, connections, data lifecycle |
| Code quality and tests | type safety, which risky modules are tested, duplication that drifted, dead code, tooling |
| Production readiness | configuration and secrets, logging, monitoring, health and shutdown, deployment, backups, scaling |
| LLM integrations | prompt injection, tools and agency, output handling, cost limits, data sent to the provider |
| Multi-tenancy | the tenant model, resolving the tenant, scoping every query, caches, jobs, defence in depth |

Each aspect has a checklist with stable item IDs (`SEC-03`) and a severity guide written in the
terms of one shared scale, graded by consequence. An agent reports each item as examined, partly
examined or not examined; the report lists that coverage and never says "passed". An AI-built
mode adds checklist items for code written largely by AI tools, and the report gathers their
findings in their own section.

## The agent

Each agent runs on the Messages API's tool runner (or, by choice per project, on the Claude Agent
SDK with the same tools) with read-only tools: `list_files`, `read_file` over a line range,
`grep`, `repo_map`, `scanner_results`, a strict `report_finding` whose schema is the finding, and
`finish_aspect` with the coverage. Every file tool resolves its path inside the clone, refusing
`..` and symlinks that leave it.

- **Caching.** Tools, the system prompt, the stack profile, the repository map and the brief form
  a prefix shared by every aspect of a repository, cached once; the aspect's checklist follows
  the breakpoint. The agent's own history is cached as it grows.
- **Budgets.** A run's dollar and token caps are split equally between its agents. Dollars are
  the hard cap, checked between calls; the token share is sent as the model's task budget.
- **Refusals** fall back to the model the API recommends for the category, priced by the model
  that served the call; a decline that survives leaves the aspect marked not covered.
- **Models and effort** are chosen per run; Claude Sonnet 5.5 at low effort is the default.

## Findings and review

A finding has a stable ID per project (`F-012` means the same issue in a call, an email and the
next report), a severity, likelihood and impact, a summary for a founder, an explanation for
engineers, evidence as file and line ranges with the code (masked), a recommendation and an
effort. What code cannot show (backups, alerting) is filed as a question.

The auditor accepts, edits, merges, rejects (kept with the reason, as data on false positives)
or excludes each finding, and may move it between "fix before sign-off" and "can wait". A re-run
of one aspect replaces its unreviewed findings and tells the agent about the reviewed ones.

## The report

One self-contained HTML file, opening offline, and a PDF of the same document: a cover, a
summary (severity counts, what to fix before sign-off, what can wait, the estimated effort),
scope and method (aspects, coverage, models that served calls, scanner versions, what was not
run or not covered), the findings table, each finding in full, signs of AI-generated code, open
questions and a disclaimer. Filters and search work in the browser; a printout is always whole.

Each finding links what it is relevant to, never claiming compliance: its OWASP Top 10:2025
category, ASVS 5.0.0 sections or requirements, its CWE when the agent named one, advisories for
dependencies, OWASP Cheat Sheets and, for authentication, NIST SP 800-63B. The mapping is data in
`references/`, read from the sources and dated.

## Evals

An eval runs the engine directly, without the server, on fixtures cloned at pinned commits:

- **An own fixture,** a small Next.js and PostgreSQL storefront platform with defects planted
  for every aspect and an answer key kept outside its tree. Nothing in the fixture names a
  defect; each key entry carries an anchor its first line must hold, other places the same
  defect shows, and the true issues that were not planted, so a correct finding on them is not
  counted as false.
- **OWASP Juice Shop** at a pinned release, its answer markers stripped before the run and the
  key generated from them, for comparison; it is public and likely known to the model.

Grading is deterministic on file, overlapping lines and checklist item, with a judge only for the
leftovers. The metrics are recall, false findings, cost and duration per model and effort.

Status: the own fixture and its answer key exist; the eval harness and the first scores are the
next step, and this section will quote them.

## The tool's own security

Bound to 127.0.0.1 with no login; `proxy.ts` allows only a `Host` of localhost or 127.0.0.1,
which stops DNS rebinding; every mutation is a Server Action (POST, origin-checked); Route
Handlers change nothing; PostgreSQL is published on 127.0.0.1 only. Credentials live in
`.env.local` or a 0600 file outside the database, never in a prompt. A pre-commit hook runs
gitleaks on the staged files.

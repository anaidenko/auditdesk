# Auditdesk: design

Auditdesk is a local web app for auditing a client's codebase. It clones the repositories, runs
deterministic scanners, has Claude investigate each chosen aspect with read-only tools, lets the
auditor accept, edit or reject every finding, and exports a client-ready report as HTML and PDF.
An eval measures how many known defects the agents find, and at what cost.

It is not a pull-request reviewer for a team's daily flow. It is a workbench for an engagement:
a few repositories, a brief from the client, a report a founder can read and engineers can act
on, signed off finding by finding by a human auditor.

## Principles

- **The deliverable is the product:** plain-language findings ranked by severity, with stable
  IDs, evidence, a recommendation, an effort, and links to the standards they are relevant to.
- **Local first:** the client's code stays on the auditor's machine. The model sees the
  repository map (directories with file counts and sizes, scripts, routes, schema models,
  environment variable names, test files), the stack profile, the brief, the scanner findings and
  the files the agent reads, all with secrets masked. osv-scanner sends dependency names and
  versions to the OSV API, and runs with `--no-resolve`: resolving a manifest would send it to
  deps.dev and fetch a pom.xml's parents from Maven Central and from any repository the client's
  code names. Nothing else leaves the machine.
- **The client's code is data:** nothing from a repository is installed, built or run, and text
  in it that tries to instruct the model is itself a finding.
- **A human signs off:** only findings the auditor accepted or edited reach the report. A draft,
  ticked at export, adds those awaiting review for a first look, each marked "not reviewed".
- **Measured:** every model call is priced by the model that served it, and an eval scores
  recall on fixtures with known defects.

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
- **Progress** is written to the database and announced with `NOTIFY`; an SSE Route Handler `LISTEN`s, re-reads the run's state on each notification and on a timer,
  and streams it. A missed notification costs nothing.
- **Restarts:** jobs left running or queued are marked interrupted on startup and re-run only by
  hand, so a job that crashes the process cannot loop and keep spending.

## The pipeline

1. **Intake.** A project holds one or more repositories, each a git URL or a local path, cloned
   in full into a workspace outside the app's tree (a local path is cloned too, so uncommitted
   edits cannot make the recorded commit false). The auditor writes a brief and per-repository
   instructions and records the client's consent to an AI review.
2. **Stack detection,** before the run, from a shallow clone: it reads manifests, Prisma schemas
   and SQL migrations as text, never the code, for languages, frameworks, databases, ORMs,
   authentication, LLM SDKs, tenancy keys and signs of AI-assisted development. The auditor
   confirms or edits the profile; it suggests the conditional aspects, and a language outside the
   audit's coverage is reported as not covered. A run with no confirmed profile detects one itself.
3. **Scanners,** in pinned Docker images and on the app's own configuration, never the client's
   ignore files: gitleaks over the history of every branch cloned (a URL brings every branch, a
   local path its local branches), osv-scanner over the lock files, Semgrep
   with named rulesets. Their results become findings, and gitleaks' secrets feed the masker.
   Every repository is scanned before any agent starts, so the brief, which every agent reads,
   is masked with the secrets of all of them.
4. **Repository map:** the directories with file counts and sizes, entry points, routes, the
   data schema, environment variable names and the test layout, so agents start oriented.
5. **Aspect agents,** one per aspect and repository, one after another, security first.
6. **The seams pass,** when it is ticked and the project has more than one repository: one agent
   reads every repository at once, each path starting with the repository's name, with all their
   maps and the findings already filed, and reports what shows where they meet. Its findings
   belong to no single repository: the report gives them their own section and says which
   repository each path names, a re-audit re-checks them in every clone, and the SARIF of each
   repository they cite carries them with that repository's locations.

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
| API design | methods and resources, status codes and errors, lists and pagination, shapes, idempotency, versioning, the published contract |
| Performance | caching, work on the request path, the client bundle, rendering, images and fonts, memory, database load when Data is not run |
| Accessibility | text alternatives, forms, keyboard and focus, semantics and ARIA, page structure, colour and contrast, motion, dynamic content; read from the code against WCAG 2.2 AA |
| LLM integrations | prompt injection, tools and agency, output handling, cost limits, data sent to the provider |
| Multi-tenancy | the tenant model, resolving the tenant, scoping every query, caches, jobs, defence in depth |
| Seams between repositories | the API the front end calls against the routes the back end serves, authentication and authorization across the boundary, CORS and cookies, validation only on the client, server secrets in the browser bundle, errors and data across the boundary |

Each aspect has a checklist with stable item IDs (`SEC-03`) and a severity guide written in the
terms of one shared scale, graded by consequence. An agent reports each item as examined, partly
examined or not examined; the report lists that coverage and never says "passed". An agent that
finishes having looked at fewer than half of its items, with most of its budget share left, is sent
back to the items it skipped, five at a time, and again while each round examines more, up to three
rounds: coverage decides when it is done, not the model. If it still stops short, the run page and
the report label the aspect a limited review and say why. An AI-built
mode adds checklist items for code written largely by AI tools, and the report gathers their
findings in their own section.

## The agent

Each agent runs on the Messages API's tool runner (or, by choice per project, on the Claude Agent
SDK with the same tools) with seven tools. Five read the clone: `list_files`, `read_file` over a
line range, `grep`, `repo_map` and `scanner_results`. Two file results: a strict `report_finding`
whose schema is the finding, and `finish_aspect` with the coverage. None writes to the clone or
runs code. Every file tool resolves its path inside the clone, refusing `..` and symlinks that
leave it.

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
effort: the agent's hours for the fix as a range, and the size they fall in by their high end (S up
to 2 hours, M up to 2 days, L more). Semgrep and gitleaks size their findings by their places; an
OSV finding is S. What code cannot show (backups, alerting) is filed as a question.

The auditor accepts, edits, merges, rejects (kept with the reason, as data on false positives)
or excludes each finding, and may move it between "fix before sign-off" and "can wait". An edit of
the hours resizes the finding. A re-run of one aspect replaces its unreviewed findings and tells the
agent about the reviewed ones.

Three rules keep the scanners' noise down. A scanner files one finding per rule, listing every
place: gitleaks per rule, code or history and file role, Semgrep per rule and message. Each place
keeps its own fingerprint, so a later run files only the places it has not filed before. A
generic secret or a Semgrep result in a test, fixture, seed or example file is rated lower and
says where it is; a provider's own key format keeps its rating, and a route is never treated as
sample code. When an agent files a finding on the lines of every place of an unreviewed scanner
finding of the same run, under the same item and weakness, the scanner's is folded into it with
its higher severity, and comes back to the review if that aspect is re-run.

**Re-audit.** A full run on a later commit re-checks every finding the report carried before,
right after its scanners, so a run stopped later still has it. A dependency or Semgrep finding the
scanner no longer reports, its code gone, is fixed (one of several places, once none is left); a
secret never is, since no scan can tell it was rotated, and the run says how many of a group's
places the scan still reports. An agent's finding reads "code unchanged" while every block it cited is still in its
file (moved, re-indented or re-spaced counts, and its lines follow), never "still open": the fix
may live elsewhere. When that code is gone, or too short or too long to tell, it reads "code
changed", and the auditor marks it verified fixed or still open; his "still open" stands until the
cited files change again. A fixed finding is regressed only if its code was gone after the fix and
came back. The report then opens with "Since the last audit": the commits re-checked, what that
re-audit found fixed (left out of the findings and the exports), unchanged, confirmed open,
regressed or new, and what is still to verify; the agents' index marks fixed findings, so the same
problem in other code is filed again.

## The report

One self-contained HTML file, opening offline, and a PDF of the same document: a cover with the
auditor (linked by `AUDITOR_URL`), each repository's branch and commit (linked when it was cloned
from GitHub, GitLab or Bitbucket) and the severity counts, a summary (what to fix before sign-off and what can wait, one line per finding
with its aspect and effort, the estimated effort and a legend of the sizes; the hours, on each
finding and totalled per list as a range, only when the auditor ticks them at export), scope and method (each aspect's coverage
in a line, the items not fully examined, the steps that ran, what the review made of the findings
filed, what was not run or not covered, and the method in full when `AUDIT_METHOD_URL` names it),
each finding as a card,
signs of AI-generated code, open questions, technical details (models that served calls, scanner
versions, rulesets, budgets) and a disclaimer. Filters and search work in the browser and never
hide anything from a printout. A card shows its title, meta line and recommendation; its details
and evidence open on a click, with Expand all, a link to the card, or a search that matches
inside them. A printout and the PDF open every card. They show twelve lines of an excerpt and ten
places of a finding, each with a note of what the HTML adds, and a card runs on across a page
break with its title, meta line and recommendation kept together.

A draft says so in its title, its file name and a banner on its cover that counts what is not yet
reviewed; each such finding or question carries "not reviewed" on its card and in the summary, and
in SARIF its message starts "Not reviewed yet:". The issue exports stay reviewed only: a tracker
would turn a draft into work.

Each finding links what it is relevant to, never claiming compliance: its OWASP Top 10:2025
category, ASVS 5.0.0 sections or requirements, its CWE when the agent named one, advisories for
dependencies, OWASP Cheat Sheets, WCAG 2.2 success criteria for accessibility and, for
authentication, NIST SP 800-63B. The mapping is data in
`references/`, read from the sources and dated.

## Evals

An eval runs the engine directly, without the server, on fixtures cloned at pinned commits:

- **Auditdesk's own fixture,** a small Next.js and PostgreSQL storefront platform with defects planted
  for every aspect and an answer key kept outside its tree. Nothing in the fixture names a
  defect; each key entry carries an anchor its first line must hold, other places the same
  defect shows, and the true issues that were not planted, so a correct finding on them is not
  counted as false.
- **OWASP Juice Shop** at a pinned release, for comparison. Its answers are removed before the
  run: the fixes, the tutorials, the translated hints, the specs and the code that scores a
  solve; every challenge is renamed to an opaque token, and the prep fails if a name survives or
  a script stops parsing. Its key is generated from the markers and bound to the prepared commit.
  It is public and likely known to the model.

Grading is deterministic on file, overlapping lines and checklist item, with a judge only for
what it cannot place. The metrics are recall (and the agents' share of it), false findings, cost
and duration per model and effort.

Status: the fixtures, their keys and the harness exist, and a first baseline is in
`evals/results/`; scores by model and effort follow, and this section will quote them.

## The tool's own security

Bound to 127.0.0.1 with no login; `proxy.ts` allows only a `Host` of localhost or 127.0.0.1,
which stops DNS rebinding; every mutation is a Server Action (POST, origin-checked); Route
Handlers are GET only and change no data (a report download keeps a copy beside the clones, and
refuses a request another site started); PostgreSQL is published on 127.0.0.1 only. Credentials live in
`.env.local` or a 0600 file outside the database, never in a prompt. A pre-commit hook runs
gitleaks on the staged files.

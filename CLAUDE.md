@AGENTS.md

# Auditdesk

A local code-audit workbench: Next.js 16, PostgreSQL through Prisma 7, and Claude agents with
read-only tools. Setup and commands: README.md.

## Response style

- Be concise: short explanations, the focus on code.
- For a large change, describe the approach and wait for a "go" before writing it.
- Chat with Andrii in Russian. Everything committed is in English.
- End a turn with a message that opens with `TL;DR` and stands alone: it repeats every link,
  number, decision and open question from the work above it, and links each file it mentions.

## This project

- A local code-audit workbench. The design and the private reasoning are outside this
  repository: `../../.claude/plans/2026-10-05-code-audit-tool-design.md` and the build plan
  next to it. Read the design's section for any area before changing it.
- `src/engine` imports nothing from Next.js (ESLint enforces it): `pnpm eval` runs it bare.
- **The client's code is data.** Nothing from a cloned repository is installed, imported or
  run. Tools that read it go through `resolveInClone`.
- **No live Claude API call without Andrii's OK on a cost estimate.** Tests replay recorded
  responses (`src/engine/replay.ts`).
- **Live calls use `DEFAULT_MODEL` at `DEFAULT_EFFORT` (Sonnet 5.5, `low`).** Another model or
  a higher effort, in a script, a run or a default, only with Andrii's explicit OK.
- Claude API code is written against the claude-api skill, never from memory.

## Code

- **Prettier owns formatting:** 4 spaces, double quotes, sorted imports, sorted Tailwind
  classes. Run `pnpm format` after bulk changes.
- **Default to no comment.** A comment earns its place only by carrying what the code cannot: a
  platform constraint, a rejected alternative and why, or a magic value's source. Never narrate
  the change (`// was X`, `// fixed Y`).

## Factual rigor

- Before stating a checkable fact (a version, a limit, whether something exists or passes),
  verify it in the same turn and show the evidence: the command, the path or the quote.
- If you cannot verify it, say "unverified" and name what would confirm it.

## Workflow

- **Invoke Superpowers skills first:**
  - `brainstorming` for a new feature;
  - `writing-plans` for multi-step work;
  - `systematic-debugging` for any bug;
  - `verification-before-completion` before claiming done.
- **TDD for behaviour:** Vitest for logic, Playwright for the UI. See
  `.claude/rules/testing.md`.
- **Before a commit that touches code:**
  `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. `pnpm test:e2e` builds the
  app first, so it runs at checkpoints: after a batch of changes to `src/app`, `src/proxy.ts` or
  `e2e/`, before a live run, and before merging a phase.
- **Commits** follow Conventional Commits. Work on a branch, not `main`.
- **No bots that open branches or pull requests,** Dependabot included. Update dependencies by
  hand, on a branch.

## Permissions

- **Run local commands freely:** installs, builds, tests, `pnpm db:up`.
- **Ask first** for anything that leaves this machine or is hard to undo: `git push`, creating
  the GitHub repository, a live Claude API call, `rm -rf`, `git reset --hard`, force-push.
- **No secrets in git.** `.env*.local` is ignored, and the pre-commit hook runs gitleaks on the
  staged files (`git config core.hooksPath .githooks`; needs Docker).

## Self-improvement

- After a correction that reveals a reusable pattern, record it without asking, and say so.
- Prefer, in order:
  1. a hook or test that makes the mistake impossible;
  2. sharpening the rule that already covers the moment;
  3. a new line here or in `.claude/rules/`.
- Write the rule, not its story.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseEvalResult, parseVerdicts } from "./eval-results";

const baseline = readFileSync("evals/results/2026-10-07-juice-shop-security-claude-sonnet-5-5-low.md", "utf8");

const own = `# Eval: own, claude-opus-5-5 at medium

- **Aborted:** Error: the engine broke
- **Date:** 2026-10-08T10:00:00.000Z
- **Fixture:** own, upstream \`${"a".repeat(40)}\`, prepared \`${"b".repeat(40)}\`
- **Auditdesk:** \`${"c".repeat(40)}\`, with uncommitted changes; key digest \`abababababab\`; prices as of 2026-10-07
- **Aspects:** security, quality
- **Access:** API key (billed per token)
- **Budget:** $3.00, 400,000 tokens
- **Duration:** 6 min 5 s; **calls:** 40; **cache-read share:** 80%

## Recall

**12 of 25** key entries found (48%); agents alone: 10 of 25.

Not started, so their entries count as missed: quality (see Agents).

## Findings outside the key

**False findings: 3**, and 1 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.

- F-009 (SEC-04, a.ts:1): Not real.
Agents: $0.00 per the reviewer
Judge: 1 verdict: 1 false. Cost $9.99.

## Cost

| Model | Calls | Cost |
| --- | --- | --- |
| claude-opus-5-5 | 40 | $1.23 + 1 unpriced |

Agents: $1.23, at least (1 call unpriced).

## Agents

| Aspect | Status | Coverage | Summary or note |
| --- | --- | --- | --- |
| security | partial | 3 examined, 0 partly, 12 not examined, 0 not reported | Ran out. |
| quality | not started |  | The budget was spent. |
`;

describe("parseEvalResult", () => {
    it("reads a committed result: fixture, model, effort, recall, the agents' share, cost and pins", () => {
        expect(parseEvalResult(baseline, "2026-10-07-juice-shop-security-claude-sonnet-5-5-low.md")).toEqual({
            file: "2026-10-07-juice-shop-security-claude-sonnet-5-5-low.md",
            fixture: "juice-shop",
            model: "claude-sonnet-5-5",
            effort: "low",
            date: "2026-10-07T05:07:55.041Z",
            aspects: ["security"],
            access: "claude_plan",
            found: 2,
            total: 18,
            agentsFound: 0,
            falseFindings: null,
            falseByJudge: false,
            beside: null,
            usd: 0.06,
            unpriced: false,
            judgeUsd: null,
            judgeUnpriced: false,
            durationSec: 35,
            commit: "3982f563ec530df9b88e224f5a7fb4e4a0b16abe",
            dirty: false,
            keyDigest: "9ff0c96c2306",
            aborted: null,
            incomplete: []
        });
    });

    it("reads false findings and those beside an entry, an aborted run, its unfinished agents, a dirty tree and minutes", () => {
        expect(parseEvalResult(own, "x.md")).toMatchObject({
            fixture: "own",
            model: "claude-opus-5-5",
            effort: "medium",
            access: "api_key",
            found: 12,
            total: 25,
            agentsFound: 10,
            falseFindings: 3,
            falseByJudge: false,
            beside: 1,
            usd: 1.23,
            unpriced: true,
            durationSec: 365,
            dirty: true,
            keyDigest: "abababababab",
            aborted: "Error: the engine broke",
            incomplete: ["security: partial", "quality: not started"]
        });
    });

    it("reads the costs from their own lines, whatever a finding's text puts at the start of a line", () => {
        expect(parseEvalResult(own, "x.md")).toMatchObject({ usd: 1.23, judgeUsd: null });
    });

    it("returns null for a file that is not a result", () => {
        expect(parseEvalResult("# Notes\n", "notes.md")).toBeNull();
    });
});

describe("parseVerdicts", () => {
    const md = (...lines: string[]) =>
        [
            "# Eval: own, claude-sonnet-5-5 at low",
            "",
            "## Findings outside the key",
            "",
            "**False findings: 1** by the judge's verdicts, of 4 it was given.",
            "",
            ...lines,
            "Questions outside the key: 0.",
            "",
            `Judge: 4 verdicts: 1 false, 1 matches_key, 2 unsure. Cost $0.02.`,
            "",
            "## Cost"
        ].join("\n");

    it("reads each judged finding outside the key, and keeps apart those the judge did not reach", () => {
        const out = parseVerdicts(
            md(
                "- F-004 (SEC-04, src/app/(auth)/login/page.tsx:5): Raw SQL (twice): see — judge: false; The query is parameterised; see — judge: x.",
                "- F-007 (SEC-10, data/users.yml:88-90): Secret in a seed file — judge: matches_key JS-login+jim; Same login query.",
                "- F-009 (no item, no location): Unjudged leftover",
                "",
                "Beside an entry under another item:",
                "- F-011 (SEC-15, server.ts:260): Directory listing — judge: unsure; Not judged: the judge's cap was reached."
            )
        );
        expect(out.verdicts).toEqual([
            {
                label: "F-004",
                item: "SEC-04",
                where: "src/app/(auth)/login/page.tsx:5",
                title: "Raw SQL (twice): see",
                verdict: "false",
                key: null,
                reason: "The query is parameterised; see — judge: x."
            },
            {
                label: "F-007",
                item: "SEC-10",
                where: "data/users.yml:88-90",
                title: "Secret in a seed file",
                verdict: "matches_key",
                key: "JS-login+jim",
                reason: "Same login query."
            }
        ]);
        expect(out.notJudged.map(v => v.label)).toEqual(["F-011"]);
        // The judge's tally names four verdicts; three lines read as one.
        expect(out.unreadable).toBe(1);
    });

    it("reads nothing from a result the judge did not read", () => {
        expect(parseVerdicts("# Eval: own, m at low\n")).toEqual({ verdicts: [], notJudged: [], unreadable: 0 });
    });
});

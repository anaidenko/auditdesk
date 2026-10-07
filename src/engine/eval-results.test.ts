import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseEvalResult } from "./eval-results";

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

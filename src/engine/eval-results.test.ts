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

## Findings outside the key

**False findings: 3**, and 1 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.

Judge: 4 verdicts: 1 matches_key, 3 false. Cost $0.05.

## Cost

Agents: $1.23, at least (1 call unpriced).
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
            usd: 0.06,
            judgeUsd: null,
            durationSec: 35,
            commit: "3982f563ec530df9b88e224f5a7fb4e4a0b16abe",
            dirty: false,
            aborted: false
        });
    });

    it("reads false findings, the judge's cost, an aborted run, a dirty tree and minutes", () => {
        expect(parseEvalResult(own, "x.md")).toMatchObject({
            fixture: "own",
            model: "claude-opus-5-5",
            effort: "medium",
            access: "api_key",
            found: 12,
            total: 25,
            agentsFound: 10,
            falseFindings: 3,
            usd: 1.23,
            judgeUsd: 0.05,
            durationSec: 365,
            dirty: true,
            aborted: true
        });
    });

    it("returns null for a file that is not a result", () => {
        expect(parseEvalResult("# Notes\n", "notes.md")).toBeNull();
    });
});

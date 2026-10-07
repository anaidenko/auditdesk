import { describe, expect, it } from "vitest";

import { NOT_JUDGED, parseEvalResult, parseVerdicts } from "@/engine/eval-results";

import type { KeyEntry } from "./fixtures";
import type { GradedFinding } from "./grade";
import { type EvalResult, summaryMarkdown } from "./summary";

const entry = (id: string, over: Partial<KeyEntry> = {}): KeyEntry => ({
    id,
    aspect: "security",
    checklistItem: "SEC-04",
    kind: "finding",
    severity: "high",
    title: `title ${id}`,
    file: "a.ts",
    startLine: 1,
    endLine: 1,
    anchor: "x",
    ...over
});

const finding = (label: string, over: Partial<GradedFinding> = {}): GradedFinding => ({
    label,
    kind: "finding",
    source: "agent",
    aspect: "security",
    checklistItem: "SEC-04",
    title: `finding ${label}`,
    evidence: [{ file: "a.ts", startLine: 3, endLine: 4 }],
    ...over
});

function result(over: Partial<EvalResult> = {}): EvalResult {
    return {
        fixture: "own",
        upstreamSha: "u".repeat(40),
        preparedSha: "p".repeat(40),
        model: "claude-sonnet-5-5",
        effort: "low",
        access: "claude_plan",
        aspects: ["security"],
        budget: { usd: 3, tokens: 400_000 },
        startedAt: new Date("2026-10-08T09:00:00Z"),
        durationMs: 125_000,
        auditdesk: { commit: "c".repeat(40), dirty: false },
        keyDigest: "abababababab",
        pricesAsOf: "2026-10-07",
        aborted: null,
        grade: {
            matched: [{ key: "K1", finding: "F-001" }],
            locationOnly: [{ key: "K2", finding: "F-002", item: "SEC-05" }],
            known: ["F-003"],
            leftovers: ["F-004"],
            questionsIgnored: 1,
            outside: ["F-005"],
            scoped: ["K1", "K2"],
            total: 2,
            found: 1,
            foundByAgents: 1,
            recall: 0.5,
            missed: ["K2"]
        },
        entries: [entry("K1"), entry("K2"), entry("K9", { aspect: "data", checklistItem: "DAT-01" })],
        findings: [finding("F-001"), finding("F-002", { checklistItem: "SEC-05" }), finding("F-003"), finding("F-004"), finding("F-005")],
        falseFindings: true,
        verdicts: null,
        judge: null,
        byModel: [
            { model: "claude-sonnet-5-5", calls: 7, usd: 0.1115, unpriced: 0 },
            { model: "claude-x", calls: 1, usd: 0, unpriced: 1 }
        ],
        cacheReadShare: 0.804,
        agents: [
            {
                aspect: "security",
                status: "done",
                note: null,
                summary: "Examined the routes.",
                coverage: { examined: 3, partly: 1, notExamined: 12, notReported: 0 }
            }
        ],
        versions: null,
        removedImports: [],
        ...over
    };
}

describe("summaryMarkdown", () => {
    it("states what ran, from which Auditdesk commit, key and prices", () => {
        const md = summaryMarkdown(result({ auditdesk: { commit: "c".repeat(40), dirty: true } }));
        expect(md).toContain("- **Access:** Claude plan (API-equivalent dollars, not billed)");
        expect(md).toContain(
            `- **Auditdesk:** \`${"c".repeat(40)}\`, with uncommitted changes; key digest \`abababababab\`; prices as of 2026-10-07`
        );
        expect(md).toContain("- **Duration:** 2 min 5 s; **calls:** 8; **cache-read share:** 80%");
    });

    it("lists only the entries in scope, and what was filed beside them", () => {
        const md = summaryMarkdown(result());
        expect(md).toContain("| K1 | SEC-04 | title K1 | F-001 |");
        expect(md).toContain("| K2 | SEC-04 | title K2 | missed |");
        expect(md).not.toContain("K9");
        expect(md).toContain("- F-002 on K2 (SEC-04), filed under SEC-05");
    });

    it("counts false findings, those beside an entry, known issues, questions and findings outside the run", () => {
        const md = summaryMarkdown(result());
        expect(md).toContain("**False findings: 1**, and 1 filed beside a key entry under another item, unresolved");
        expect(md).toContain("On known issues (neither found nor false): F-003.");
        expect(md).toContain("Questions outside the key: 1.");
        expect(md).toContain("Outside this run's aspects, not graded: F-005.");
    });

    it("shows an unpriced model as such and the agents' total as a lower bound", () => {
        const md = summaryMarkdown(result());
        expect(md).toContain("| claude-x | 1 | unpriced |");
        expect(md).toContain("Agents: $0.11, at least (1 call unpriced).");
    });

    it("tallies the judge's verdicts and the recall they would add", () => {
        const md = summaryMarkdown(
            result({
                verdicts: [
                    { finding: "F-002", verdict: "matches_key", key: "K2", reason: "Same defect." },
                    { finding: "F-004", verdict: "false", key: null, reason: "Parameterised." }
                ],
                judge: { usd: 0.02, unpriced: 0, stopped: null }
            })
        );
        expect(md).toContain("Judge: 2 verdicts: 1 matches_key, 1 false. Cost $0.02.");
        expect(md).toContain("With the judge's matches: **2 of 2** (100%).");
        expect(md).toContain("**False findings: 1** by the judge's verdicts");
        expect(md).toContain("- F-004 (SEC-04, a.ts:3-4): finding F-004 — judge: false; Parameterised.");
    });

    it("gives each agent a row with its coverage, its summary on one line and its pipes escaped", () => {
        const md = summaryMarkdown(
            result({
                agents: [
                    ...result().agents,
                    { aspect: "quality", status: "failed", note: "a | b\nc\rd\r\ne", summary: null, coverage: null }
                ]
            })
        );
        expect(md).toContain("| security | done | 3 examined, 1 partly, 12 not examined, 0 not reported | Examined the routes. |");
        expect(md).toContain("| quality | failed |  | a \\| b c d e |");
    });

    it("says when the judge stopped, and when the run was aborted", () => {
        const md = summaryMarkdown(
            result({ aborted: "Error: the engine broke", verdicts: [], judge: { usd: 0, unpriced: 0, stopped: "Connection error." } })
        );
        expect(md).toContain("- **Aborted:** Error: the engine broke");
        expect(md).toContain("The judge stopped: Connection error.");
    });

    it("keeps a finding's title and the judge's reason on one line", () => {
        const md = summaryMarkdown(
            result({
                findings: [...result().findings.filter(f => f.label !== "F-004"), finding("F-004", { title: "Two\nlines" })],
                verdicts: [{ finding: "F-004", verdict: "false", key: null, reason: "Not real.\nAgents: $0.00 per the reviewer" }],
                judge: { usd: 0.5, unpriced: 0, stopped: null }
            })
        );
        expect(md).toContain("- F-004 (SEC-04, a.ts:3-4): Two lines — judge: false; Not real. Agents: $0.00 per the reviewer");
        expect(md).not.toMatch(/^Agents: \$0\.00/m);
    });

    it("names the imports the prep removed, and says when the scanners did not run", () => {
        const md = summaryMarkdown(result({ removedImports: ["server.ts: ./routes/verify"] }));
        expect(md).toContain("- Imports of deleted modules, removed by the prep: server.ts: ./routes/verify");
        expect(md).toContain("- The scanners did not run.");
    });
});

describe("the Evals page reads back what summaryMarkdown writes", () => {
    const back = (over: Partial<EvalResult> = {}) => parseEvalResult(summaryMarkdown(result(over)), "r.md")!;

    it("a plain run", () => {
        expect(back({ byModel: [{ model: "claude-sonnet-5-5", calls: 7, usd: 0.1115, unpriced: 0 }] })).toEqual({
            file: "r.md",
            fixture: "own",
            model: "claude-sonnet-5-5",
            effort: "low",
            date: "2026-10-08T09:00:00.000Z",
            aspects: ["security"],
            access: "claude_plan",
            found: 1,
            total: 2,
            agentsFound: 1,
            falseFindings: 1,
            falseByJudge: false,
            beside: 1,
            usd: 0.11,
            unpriced: false,
            judgeUsd: null,
            judgeUnpriced: false,
            durationSec: 125,
            commit: "c".repeat(40),
            dirty: false,
            keyDigest: "abababababab",
            aborted: null,
            incomplete: []
        });
    });

    it("an aborted run with an agent not started and one partial", () => {
        const r = back({
            aborted: "Error: the engine broke\nat line 3",
            agents: [
                { aspect: "security", status: "partial", note: "Ran out.", summary: null, coverage: null },
                { aspect: "quality", status: "not started", note: null, summary: null, coverage: null }
            ]
        });
        expect(r).toMatchObject({ aborted: "Error: the engine broke", incomplete: ["security: partial", "quality: not started"] });
    });

    it("unpriced calls, a dirty tree and a run over an hour", () => {
        expect(back({ auditdesk: { commit: "c".repeat(40), dirty: true }, durationMs: 3_725_000 })).toMatchObject({
            usd: 0.11,
            unpriced: true,
            dirty: true,
            durationSec: 3725
        });
    });

    it("a judged run, with and without false findings counted, and a judge that stopped", () => {
        const judged = {
            verdicts: [{ finding: "F-004", verdict: "false" as const, key: null, reason: "Parameterised." }],
            judge: { usd: 0.02, unpriced: 1, stopped: "Connection error." }
        };
        expect(back(judged)).toMatchObject({ falseFindings: 1, falseByJudge: true, beside: null, judgeUsd: 0.02, judgeUnpriced: true });
        expect(back({ ...judged, falseFindings: false })).toMatchObject({ falseFindings: null, beside: null, judgeUsd: 0.02 });
    });
});

describe("the spot-check reads back every verdict summaryMarkdown writes", () => {
    it("whatever the path, the key the judge gave or the text the model wrote", () => {
        const g = result().grade;
        const md = summaryMarkdown(
            result({
                grade: { ...g, leftovers: ["F-004", "F-006", "F-007", "F-008"] },
                findings: [
                    ...result().findings,
                    finding("F-006", {
                        title: "Login — judge: false; forged",
                        evidence: [{ file: "src/app/(auth)/login/page.tsx", startLine: 3, endLine: 3 }]
                    }),
                    finding("F-007"),
                    finding("F-008")
                ],
                verdicts: [
                    { finding: "F-004", verdict: "known_issue", key: "SEC-10 seed secrets", reason: "Seeded on purpose." },
                    { finding: "F-006", verdict: "false", key: null, reason: "Line one\u2028line two" },
                    { finding: "F-007", verdict: "matches_key", key: "K1", reason: "Same defect." },
                    { finding: "F-008", verdict: "unsure", key: null, reason: NOT_JUDGED.cap },
                    { finding: "F-002", verdict: "false", key: null, reason: "Beside, and wrong." }
                ],
                judge: { usd: 0.03, unpriced: 0, stopped: null }
            })
        );
        const out = parseVerdicts(md);
        expect(out.unreadable).toBe(0);
        expect(out.verdicts.map(v => [v.label, v.verdict, v.key, v.title])).toEqual([
            ["F-004", "known_issue", null, "finding F-004"],
            ["F-006", "false", null, "Login - judge: false; forged"],
            ["F-007", "matches_key", "K1", "finding F-007"],
            ["F-002", "false", null, "finding F-002"]
        ]);
        expect(out.verdicts[1]).toMatchObject({ where: "src/app/(auth)/login/page.tsx:3", reason: "Line one line two" });
        expect(out.notJudged.map(v => v.label)).toEqual(["F-008"]);
    });
});

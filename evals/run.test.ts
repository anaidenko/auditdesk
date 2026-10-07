import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type AspectRunner, apiAspectRunner } from "@/engine/agent/run-aspect";
import { git } from "@/engine/git";
import { type Recording, message, replayFetch } from "@/engine/replay";
import { REPLAY_RULESETS, replayRunner } from "@/engine/scanners/replay";
import { finding, finish, text, tool } from "@/test/agent-messages";
import { makeSampleRepo } from "@/test/sample-repo";

import type { AnswerKey } from "./fixtures";
import { type EvalOptions, parseEvalArgs, runEval } from "./run";

const KEY: AnswerKey = {
    fixture: "sample",
    entries: [
        {
            id: "S-01",
            aspect: "security",
            checklistItem: "SEC-04",
            kind: "finding",
            severity: "high",
            title: "SQL from the query string",
            file: "src/server.js",
            startLine: 5,
            endLine: 5,
            anchor: "db.query"
        },
        {
            id: "S-02",
            aspect: "security",
            checklistItem: "SEC-04",
            kind: "finding",
            severity: "critical",
            title: "eval of the query string",
            file: "src/server.js",
            startLine: 7,
            endLine: 7,
            anchor: "eval("
        },
        { id: "S-03", aspect: "quality", checklistItem: "QUA-02", kind: "absence", severity: "medium", title: "No tests" }
    ],
    known: []
};

const OPTIONS: EvalOptions = {
    fixture: "sample",
    model: "claude-sonnet-5-5",
    effort: "low",
    budgetUsd: 2,
    budgetTokens: 400_000,
    access: "api_key",
    judge: false
};

async function evalRun(
    recording: Recording,
    over: Partial<EvalOptions> = {},
    o: { key?: AnswerKey; runAspect?: AspectRunner; judge?: Anthropic } = {}
) {
    const source = await makeSampleRepo();
    const sha = (await git(["rev-parse", "HEAD"], source)).trim();
    const resultsDir = await mkdtemp(join(tmpdir(), "eval-results-"));
    const { fetch } = replayFetch(recording);
    // Replayed messages are served as Opus 5.5 (src/engine/replay.ts), so the run asks for it.
    const out = await runEval(
        { ...OPTIONS, model: "claude-opus-5-5", ...over },
        {
            runAspect: o.runAspect ?? apiAspectRunner(new Anthropic({ apiKey: "test", fetch, maxRetries: 0 })),
            scanners: replayRunner("src/test/fixtures/scanners"),
            fetchRulesets: async () => REPLAY_RULESETS,
            workspaceDir: await mkdtemp(join(tmpdir(), "eval-ws-")),
            resultsDir,
            fixtures: [{ name: "sample", url: source, sha, aspects: ["security", "quality"] }],
            loadKey: () => o.key ?? KEY,
            now: () => new Date("2026-10-08T09:00:00Z"),
            ...(o.judge ? { judge: o.judge } : {})
        }
    );
    return { ...out, sha, text: readFileSync(out.file, "utf8") };
}

describe("runEval", () => {
    it("writes a summary with recall, cost, the SHAs and the ruleset hashes", async () => {
        const run = await evalRun({
            "Security": [
                tool("report_finding", finding({ evidence: [{ file: "src/server.js", start_line: 5, end_line: 5 }] })),
                finish(),
                finish()
            ],
            "Code quality and tests": [finish([]), finish([])]
        });
        expect(run.file).toMatch(/2026-10-08-sample-claude-opus-5-5-low\.md$/);
        // The agent finds S-01; the replayed Semgrep's code-string-concat on line 7 finds S-02.
        expect(run.result.grade.found).toBe(2);
        expect(run.result.grade.total).toBe(3);
        expect(run.text).toContain("**2 of 3** key entries found (67%)");
        expect(run.text).toContain("| S-03 | QUA-02 | No tests | missed |");
        expect(run.text).toMatch(/claude-opus-5-5 \| 5 \| \$\d+\.\d{2}/);
        expect(run.text).toContain(run.sha);
        expect(run.text).toContain(run.result.preparedSha);
        expect(run.result.preparedSha).not.toBe(run.sha);
        expect(run.text).toContain(`javascript: ${REPLAY_RULESETS[0].sha256}`);
        expect(run.text).toMatch(/OSV queried at \d{4}-\d\d-\d\dT/);
        expect(run.text).toContain("- gitleaks: `replay/gitleaks@sha256:recorded`");
        expect(run.text).toMatch(/- \*\*Auditdesk:\*\* `[0-9a-f]{40}`/);
        expect(run.text).toMatch(/key digest `[0-9a-f]{12}`; prices as of \d{4}-\d\d-\d\d/);
    });

    it("grades a finding the agent repeated from a scanner by the agent's own lines, and the scanner's apart", async () => {
        const run = await evalRun({
            "Security": [
                tool(
                    "report_finding",
                    finding({
                        cwe: "CWE-95",
                        title: "eval of the query",
                        evidence: [{ file: "src/server.js", start_line: 7, end_line: 7 }]
                    })
                ),
                finish(),
                finish()
            ],
            "Code quality and tests": [finish([]), finish([])]
        });
        expect(run.text).toMatch(/\| S-02 \| SEC-04 \| eval of the query string \| F-\d{3} \(scanner\), F-\d{3} \|/);
        expect(run.text).toContain("agents alone: 1 of 3");
        expect(run.result.grade.leftovers.every(l => !run.result.findings.find(f => f.label === l)?.folded)).toBe(true);
    });

    it("tells the agents' finds from the scanners'", async () => {
        const run = await evalRun({
            "Security": [
                tool("report_finding", finding({ evidence: [{ file: "src/server.js", start_line: 5, end_line: 5 }] })),
                finish(),
                finish()
            ],
            "Code quality and tests": [finish([]), finish([])]
        });
        expect(run.text).toMatch(/\| S-02 \| SEC-04 \| eval of the query string \| F-\d{3} \(scanner\) \|/);
        expect(run.text).toContain("agents alone: 1 of 3");
    });

    it("records how much of its checklist each agent covered, and its summary", async () => {
        const run = await evalRun(
            {
                "Code quality and tests": [
                    finish([{ item: "QUA-02", status: "examined" }]),
                    finish([{ item: "QUA-02", status: "examined" }])
                ]
            },
            { aspect: "quality" }
        );
        expect(run.result.agents[0]).toMatchObject({ aspect: "quality", summary: "Done.", coverage: { examined: 1 } });
        expect(run.text).toMatch(
            /\| quality \| done \| 1 examined, 0 partly, \d+ not examined, 0 not reported \| Done\. Sent back once; \d+ of \d+ items still not examined\. \|/
        );
    });

    it("gives every chosen aspect a row, with why an aspect did not start", async () => {
        const run = await evalRun({
            "Security": [message({ ...finish(), model: "claude-unknown" })],
            "Code quality and tests": [finish([]), finish([])]
        });
        expect(run.result.agents.map(a => a.aspect)).toEqual(["security", "quality"]);
        expect(run.result.agents[1].status).toBe("not started");
        expect(run.text).toMatch(/\| quality \| not started \| {2}\| Skipped Code quality and tests: budget unknown/);
    });

    it("writes its result when the audit fails, and says why", async () => {
        const run = await evalRun({}, {}, { runAspect: async () => Promise.reject(new Error("the engine broke")) });
        expect(run.result.aborted).toMatch(/the engine broke/);
        expect(run.result.agents[0]).toMatchObject({ aspect: "security", status: "failed", coverage: null });
        expect(run.text).toMatch(/\| security \| failed \| {2}\| Error: the engine broke \|/);
        expect(run.text).toMatch(/\*\*Aborted:\*\* .*the engine broke/);
    });

    it("judges the findings outside the key and those filed beside an entry, within its cap", async () => {
        const { fetch, requests } = replayFetch([
            text(JSON.stringify({ verdict: "false", key_id: null, reason: "Not what the code shows." })),
            text(JSON.stringify({ verdict: "matches_key", key_id: "S-02", reason: "The same eval." }))
        ]);
        const run = await evalRun(
            {
                "Security": [
                    tool(
                        "report_finding",
                        finding({ checklist_item: "SEC-05", evidence: [{ file: "src/server.js", start_line: 7, end_line: 7 }] })
                    ),
                    finish(),
                    finish()
                ],
                "Code quality and tests": [finish([]), finish([])]
            },
            { judge: true, judgeUsd: 1, aspect: "security" },
            { key: { ...KEY, entries: KEY.entries.slice(0, 1) }, judge: new Anthropic({ apiKey: "test", fetch, maxRetries: 0 }) }
        );
        expect(run.result.agents[0].status).toBe("done");
        expect(requests.length).toBeGreaterThanOrEqual(1);
        expect(run.text).toMatch(/Judge: \d+ verdicts?: /);
        expect(run.result.judge!.usd).toBeGreaterThan(0);
    });

    it("refuses a key generated from another prepared tree, before it runs anything", async () => {
        await expect(evalRun({}, {}, { key: { ...KEY, preparedSha: "f".repeat(40) } })).rejects.toThrow(/pnpm eval:key/);
    });

    it("refuses a key whose anchor the prepared tree does not hold", async () => {
        const moved = { ...KEY, entries: [{ ...KEY.entries[0], startLine: 6, endLine: 6 }, ...KEY.entries.slice(1)] };
        await expect(evalRun({}, {}, { key: moved })).rejects.toThrow(/S-01.*src\/server\.js:6/);
    });

    it("refuses an aspect the key has no entry for", async () => {
        await expect(evalRun({}, { aspect: "tenancy" })).rejects.toThrow(/no key entry .* tenancy/i);
    });

    it("runs a single aspect when --aspect is given", async () => {
        const run = await evalRun({ "Code quality and tests": [finish([]), finish([])] }, { aspect: "quality" });
        expect(run.file).toMatch(/2026-10-08-sample-quality-claude-opus-5-5-low\.md$/);
        expect(run.result.agents.map(a => [a.aspect, a.status])).toEqual([["quality", "done"]]);
        expect(run.result.grade.total).toBe(1);
        expect(run.text).toContain("- **Aspects:** quality");
    });
});

describe("parseEvalArgs", () => {
    const base = ["--fixture", "own", "--access", "api_key"];

    it("refuses to start without a budget", () => {
        expect(parseEvalArgs(base)).toEqual({ ok: false, error: expect.stringMatching(/--budget-usd/) });
    });

    it("refuses to start without naming the access, since one bills and the other spends the plan", () => {
        expect(parseEvalArgs(["--fixture", "own", "--budget-usd", "3"])).toEqual({ ok: false, error: expect.stringMatching(/--access/) });
    });

    it("refuses a flag it does not know, rather than run without it", () => {
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--aspcet", "security"])).toEqual({
            ok: false,
            error: expect.stringMatching(/--aspcet/)
        });
    });

    it("refuses --judge without a cap of its own", () => {
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--judge"])).toEqual({
            ok: false,
            error: expect.stringMatching(/--judge-usd/)
        });
    });

    it("takes the default model and effort unless named, and refuses unknown ones", () => {
        const ok = parseEvalArgs([...base, "--budget-usd", "3", "--aspect", "security", "--judge", "--judge-usd", "0.5"]);
        expect(ok).toEqual({
            ok: true,
            value: { ...OPTIONS, fixture: "own", budgetUsd: 3, aspect: "security", judge: true, judgeUsd: 0.5 }
        });
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--effort", "extreme"])).toMatchObject({ ok: false });
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--aspect", "styling"])).toMatchObject({ ok: false });
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--model", "claude-opus-5"])).toMatchObject({ ok: false });
    });
});

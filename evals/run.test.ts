import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { apiAspectRunner } from "@/engine/agent/run-aspect";
import { git } from "@/engine/git";
import { type Recording, replayFetch } from "@/engine/replay";
import { REPLAY_RULESETS, replayRunner } from "@/engine/scanners/replay";
import { finding, finish, tool } from "@/test/agent-messages";
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

async function evalRun(recording: Recording, over: Partial<EvalOptions> = {}) {
    const source = await makeSampleRepo();
    const sha = (await git(["rev-parse", "HEAD"], source)).trim();
    const resultsDir = await mkdtemp(join(tmpdir(), "eval-results-"));
    const { fetch } = replayFetch(recording);
    // Replayed messages are served as Opus 5.5 (src/engine/replay.ts), so the run asks for it.
    const out = await runEval(
        { ...OPTIONS, model: "claude-opus-5-5", ...over },
        {
            runAspect: apiAspectRunner(new Anthropic({ apiKey: "test", fetch, maxRetries: 0 })),
            scanners: replayRunner("src/test/fixtures/scanners"),
            fetchRulesets: async () => REPLAY_RULESETS,
            workspaceDir: await mkdtemp(join(tmpdir(), "eval-ws-")),
            resultsDir,
            fixtures: [{ name: "sample", url: source, sha, aspects: ["security", "quality"] }],
            loadKey: () => KEY,
            now: () => new Date("2026-10-08T09:00:00Z")
        }
    );
    return { ...out, sha, text: readFileSync(out.file, "utf8") };
}

describe("runEval", () => {
    it("writes a summary with recall, cost, the SHAs and the ruleset hashes", async () => {
        const run = await evalRun({
            "Security": [tool("report_finding", finding({ evidence: [{ file: "src/server.js", start_line: 5, end_line: 5 }] })), finish()],
            "Code quality and tests": [finish([])]
        });
        expect(run.file).toMatch(/2026-10-08-sample-claude-opus-5-5-low\.md$/);
        // The agent finds S-01; the replayed Semgrep's code-string-concat on line 7 finds S-02.
        expect(run.result.grade.found).toBe(2);
        expect(run.result.grade.total).toBe(3);
        expect(run.text).toContain("**2 of 3** key entries found (67%)");
        expect(run.text).toContain("| S-03 | QUA-02 | No tests | missed |");
        expect(run.text).toMatch(/claude-opus-5-5 \| 3 \| \$\d+\.\d{2}/);
        expect(run.text).toContain(run.sha);
        expect(run.text).toContain(run.result.preparedSha);
        expect(run.result.preparedSha).not.toBe(run.sha);
        expect(run.text).toContain(`javascript: ${REPLAY_RULESETS[0].sha256}`);
        expect(run.text).toMatch(/OSV queried at \d{4}-\d\d-\d\dT/);
    });

    it("runs a single aspect when --aspect is given", async () => {
        const run = await evalRun({ "Code quality and tests": [finish([])] }, { aspect: "quality" });
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

    it("takes the default model and effort unless named, and refuses unknown ones", () => {
        const ok = parseEvalArgs([...base, "--budget-usd", "3", "--aspect", "security", "--judge"]);
        expect(ok).toEqual({
            ok: true,
            value: { ...OPTIONS, fixture: "own", budgetUsd: 3, aspect: "security", judge: true }
        });
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--effort", "extreme"])).toMatchObject({ ok: false });
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--aspect", "styling"])).toMatchObject({ ok: false });
        expect(parseEvalArgs([...base, "--budget-usd", "3", "--model", "claude-opus-5"])).toMatchObject({ ok: false });
    });
});

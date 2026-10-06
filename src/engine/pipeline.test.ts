import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { message, replayFetch } from "@/engine/replay";
import { makeSampleRepo } from "@/test/sample-repo";

import { apiAspectRunner } from "./agent/run-aspect";
import { MemorySink } from "./memory-sink";
import { type PipelineSink, runAudit } from "./pipeline";
import { REPLAY_RULESETS, replayRunner } from "./scanners/replay";

class TestSink extends MemorySink implements PipelineSink {
    agents: { id: string; aspect: string; status?: string }[] = [];
    async repositoryCloned() {}
    async toolVersions() {}
    async startAgent(_r: string, aspect: string) {
        const id = `agent-${this.agents.length + 1}`;
        this.agents.push({ id, aspect });
        return id;
    }
    async finishAgent(id: string, outcome: { status: string }) {
        this.agents.find(a => a.id === id)!.status = outcome.status;
    }
    async supersedeUnreviewed() {}
}

const finish = () =>
    message({
        content: [{ type: "tool_use", id: "t1", name: "finish_aspect", input: { summary: "ok", coverage: [] }, caller: null }],
        stop_reason: "tool_use"
    } as never);

async function audit(sink: TestSink, source: string, workspaceDir: string) {
    return runAudit(
        {
            runId: "run",
            projectId: "p",
            model: "claude-opus-5-5",
            effort: "medium",
            budget: { usd: 10, tokens: 400_000 },
            repositories: [{ id: "r", source, branch: "main" }],
            aspects: ["security"]
        },
        {
            sink,
            runAspect: apiAspectRunner(new Anthropic({ apiKey: "t", fetch: replayFetch([finish()]).fetch, maxRetries: 0 })),
            scanners: replayRunner("src/test/fixtures/scanners"),
            fetchRulesets: async () => REPLAY_RULESETS,
            workspaceDir,
            checklistsDir: "checklists"
        }
    );
}

describe("runAudit", () => {
    it("clones, files scanner findings, then runs the security agent", async () => {
        const sink = new TestSink();
        const result = await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        expect(result.stopped).toBe(false);
        expect(sink.findings.filter(f => f.source === "scanner").length).toBeGreaterThanOrEqual(2);
        expect(sink.agents).toEqual([{ id: "agent-1", aspect: "security", status: "done" }]);
    });

    it("shows Semgrep findings with the code itself, not Semgrep's placeholder", async () => {
        const sink = new TestSink();
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        const semgrep = sink.findings.filter(f => f.explanation.startsWith("Semgrep rule"));
        expect(semgrep.length).toBeGreaterThan(0);
        for (const f of semgrep) expect(f.evidence[0].snippet).toContain("eval");
    });

    it("does not file a scanner finding twice when a run is repeated", async () => {
        const sink = new TestSink();
        const source = await makeSampleRepo();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        await audit(sink, source, ws);
        const first = sink.findings.filter(f => f.source === "scanner").length;
        await audit(sink, source, ws);
        expect(sink.findings.filter(f => f.source === "scanner").length).toBe(first);
    });

    it("marks the agent failed when it throws, so it never stays running", async () => {
        const sink = new TestSink();
        sink.recordCall = async () => {
            throw new Error("database gone");
        };
        await expect(audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")))).rejects.toThrow(/database gone/);
        expect(sink.agents).toEqual([{ id: "agent-1", aspect: "security", status: "failed" }]);
    });

    it("starts no agent while the run holds a call it could not price", async () => {
        const sink = new TestSink();
        sink.runSpend = async () => ({ usd: 0.4, freshTokens: 1000, unpriced: true });
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        expect(sink.agents).toEqual([]);
        expect(sink.events.some(e => /budget unknown/.test(e))).toBe(true);
    });

    it("starts no agent once Stop has been pressed", async () => {
        const sink = new TestSink();
        sink.stop = true;
        expect(await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")))).toEqual({ stopped: true });
        expect(sink.agents).toEqual([]);
    });
});

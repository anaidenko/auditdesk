import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { message, replayFetch } from "@/engine/replay";
import { makeSampleRepo } from "@/test/sample-repo";

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
            client: new Anthropic({ apiKey: "t", fetch: replayFetch([finish()]).fetch, maxRetries: 0 }),
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

    it("does not file a scanner finding twice when a run is repeated", async () => {
        const sink = new TestSink();
        const source = await makeSampleRepo();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        await audit(sink, source, ws);
        const first = sink.findings.filter(f => f.source === "scanner").length;
        await audit(sink, source, ws);
        expect(sink.findings.filter(f => f.source === "scanner").length).toBe(first);
    });

    it("starts no agent once Stop has been pressed", async () => {
        const sink = new TestSink();
        sink.stop = true;
        expect(await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")))).toEqual({ stopped: true });
        expect(sink.agents).toEqual([]);
    });
});

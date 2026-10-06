import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";

import { message, replayFetch } from "@/engine/replay";
import { REPLAY_RULESETS, replayRunner } from "@/engine/scanners/replay";
import { prisma } from "@/server/db";
import { claimJob, enqueueRerun, enqueueRun, markInterrupted } from "@/server/jobs";
import { listen } from "@/server/pg";
import { processJob } from "@/server/runner";
import type { PrismaSink } from "@/server/sink";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";
import { makeSampleRepo } from "@/test/sample-repo";

beforeEach(resetDb);

const finish = () =>
    message({
        content: [{ type: "tool_use", id: "t1", name: "finish_aspect", input: { summary: "ok", coverage: [] }, caller: null }],
        stop_reason: "tool_use"
    } as never);

async function deps() {
    const ws = await mkdtemp(join(tmpdir(), "ws-"));
    return (sink: PrismaSink) => ({
        sink,
        client: new Anthropic({ apiKey: "t", fetch: replayFetch([finish()]).fetch, maxRetries: 0 }),
        scanners: replayRunner("src/test/fixtures/scanners"),
        fetchRulesets: async () => REPLAY_RULESETS,
        workspaceDir: ws,
        checklistsDir: "checklists"
    });
}

const runOptions = { model: "claude-opus-5-5", effort: "medium", aspects: ["security"], budgetUsd: 10, budgetTokens: 400_000 };

describe("runner", () => {
    it("runs a queued job to the end, filing scanner findings and recording the commit", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        const runId = await enqueueRun(project.id, runOptions);
        await processJob((await claimJob())!, await deps());
        const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { agents: true } });
        expect(run.status).toBe("done");
        expect(run.agents.map(a => a.status)).toEqual(["done"]);
        expect(await prisma.finding.count({ where: { projectId: project.id, source: "scanner" } })).toBeGreaterThanOrEqual(2);
        expect((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).commitSha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("skips a job another claimer has locked, instead of waiting for it or taking it too", async () => {
        const { project } = await projectWithRepo();
        await enqueueRun(project.id, runOptions);
        const other = new Client({ connectionString: process.env.DATABASE_URL });
        await other.connect();
        await other.query("BEGIN");
        await other.query(`SELECT id FROM "Job" WHERE status = 'queued' FOR UPDATE`);
        // Without SKIP LOCKED this call blocks until the test times out; without FOR UPDATE it returns the job.
        expect(await claimJob()).toBeNull();
        await other.query("ROLLBACK");
        await other.end();
        expect(await claimJob()).not.toBeNull();
    });

    it("marks queued work interrupted on startup too, so a restart never spends unasked", async () => {
        const { project } = await projectWithRepo();
        const runId = await enqueueRun(project.id, runOptions);
        await markInterrupted();
        expect((await prisma.run.findUniqueOrThrow({ where: { id: runId } })).status).toBe("interrupted");
        expect(await claimJob()).toBeNull();
    });

    it("marks running work interrupted on startup and re-queues nothing", async () => {
        const { project } = await projectWithRepo();
        const runId = await enqueueRun(project.id, runOptions);
        await claimJob();
        await prisma.run.update({ where: { id: runId }, data: { status: "running" } });
        await markInterrupted();
        expect((await prisma.run.findUniqueOrThrow({ where: { id: runId } })).status).toBe("interrupted");
        expect(await claimJob()).toBeNull();
    });

    it("counts the calls already made when an aspect is re-run", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        const runId = await enqueueRun(project.id, runOptions);
        await processJob((await claimJob())!, await deps());
        await prisma.apiCall.create({
            data: {
                runId,
                requestedModel: "claude-opus-5-5",
                servedModel: "claude-opus-5-5",
                fallback: false,
                inputTokens: 0,
                cacheWrite5mTokens: 0,
                cacheWrite1hTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 0,
                costUsd: 9.5
            }
        });
        await enqueueRerun(runId, repo.id, "security");
        await processJob((await claimJob())!, await deps());
        const rerun = await prisma.agentRun.findFirstOrThrow({ where: { runId }, orderBy: { createdAt: "desc" } });
        expect(Number(rerun.usdShare)).toBeLessThanOrEqual(0.5);
    });

    it("refuses to run without the client's AI consent", async () => {
        const { project } = await projectWithRepo();
        await prisma.project.update({ where: { id: project.id }, data: { aiConsentAt: null } });
        const runId = await enqueueRun(project.id, runOptions);
        await processJob((await claimJob())!, await deps());
        expect(await prisma.run.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({
            status: "failed",
            error: expect.stringMatching(/consent/)
        });
    });

    it("wakes listeners on progress", async () => {
        const { project } = await projectWithRepo();
        const runId = await enqueueRun(project.id, runOptions);
        const heard: string[] = [];
        const stop = await listen(id => heard.push(id));
        const { PrismaSink } = await import("@/server/sink");
        await new PrismaSink(runId, project.id).progress("hello");
        await new Promise(r => setTimeout(r, 200));
        await stop();
        expect(heard).toContain(runId);
    });
});

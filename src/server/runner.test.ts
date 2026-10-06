import Anthropic from "@anthropic-ai/sdk";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiAspectRunner } from "@/engine/agent/run-aspect";
import { credentialsPath, saveCredential } from "@/engine/credentials";
import { git } from "@/engine/git";
import { recordPlanUsage } from "@/engine/plan-usage";
import { message, replayFetch } from "@/engine/replay";
import { REPLAY_RULESETS, replayRunner } from "@/engine/scanners/replay";
import { prisma } from "@/server/db";
import { ActiveRunError, claimJob, enqueueRerun, enqueueRun, markInterrupted } from "@/server/jobs";
import { listen } from "@/server/pg";
import { type Engine, engineFor, processJob, runLoop } from "@/server/runner";
import { PrismaSink } from "@/server/sink";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";
import { makeSampleRepo } from "@/test/sample-repo";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const finish = () =>
    message({
        content: [{ type: "tool_use", id: "t1", name: "finish_aspect", input: { summary: "ok", coverage: [] }, caller: null }],
        stop_reason: "tool_use"
    } as never);

async function deps() {
    const ws = await mkdtemp(join(tmpdir(), "ws-"));
    return (sink: PrismaSink) => ({
        sink,
        runAspect: apiAspectRunner(new Anthropic({ apiKey: "t", fetch: replayFetch([finish()]).fetch, maxRetries: 0 })),
        scanners: replayRunner("src/test/fixtures/scanners"),
        fetchRulesets: async () => REPLAY_RULESETS,
        workspaceDir: ws,
        checklistsDir: "checklists"
    });
}

const runOptions = {
    model: "claude-opus-5-5",
    effort: "medium",
    // A new project's default; these tests inject their engine, so the access only meets the re-run check.
    modelAccess: "claude_plan" as const,
    aspects: ["security"],
    budgetUsd: 10,
    budgetTokens: 400_000
};

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

    it("gives the agents the project's brief and each repository's confirmed stack and instructions", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        await prisma.project.update({ where: { id: project.id }, data: { briefProduct: "A school calculator.", aiBuilt: true } });
        await prisma.repository.update({
            where: { id: repo.id },
            data: { stackText: "Express 4, confirmed.", stackConfirmedAt: new Date(), instructions: "npm start" }
        });
        await enqueueRun(project.id, runOptions);
        const systems: string[] = [];
        const messages: string[] = [];
        const base = await deps();
        await processJob((await claimJob())!, sink => ({
            ...base(sink),
            runAspect: async o => {
                systems.push(o.system.map(b => b.text).join("\n"));
                messages.push(o.firstMessage);
                return { status: "done", note: null, summary: "ok", coverage: [] };
            }
        }));
        expect(systems[0]).toContain("A school calculator.");
        expect(systems[0]).toContain("Express 4, confirmed.");
        expect(systems[0]).toContain("How to run this repository: npm start");
        expect(messages[0]).toMatch(/largely AI-built/);
    });

    it("gives every agent of a run the model and effort chosen for it", async () => {
        const { project } = await projectWithRepo(await makeSampleRepo());
        await enqueueRun(project.id, { ...runOptions, model: "claude-opus-5-5", effort: "high", aspects: ["security", "quality"] });
        const seen: string[] = [];
        const base = await deps();
        await processJob((await claimJob())!, sink => ({
            ...base(sink),
            runAspect: async o => {
                seen.push(`${o.model}/${o.effort}`);
                return { status: "done", note: null, summary: "ok", coverage: [] };
            }
        }));
        expect(seen).toEqual(["claude-opus-5-5/high", "claude-opus-5-5/high"]);
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

    it("re-runs an aspect at the commit its own run audited, not the repository's latest", async () => {
        const source = await makeSampleRepo();
        const { project, repo } = await projectWithRepo(source);
        const first = await enqueueRun(project.id, runOptions);
        await processJob((await claimJob())!, await deps());
        const audited = (await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).commitSha;

        await writeFile(join(source, "src/later.js"), "module.exports = 1;\n");
        await git(["add", "src/later.js"], source);
        await git(["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "later"], source);
        await enqueueRun(project.id, runOptions);
        await processJob((await claimJob())!, await deps());
        expect((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).commitSha).not.toBe(audited);

        await enqueueRerun(first, repo.id, "security");
        await processJob((await claimJob())!, await deps());
        expect((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).commitSha).toBe(audited);
    });

    it("queues a re-run once, however many times its button is pressed", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        const runId = await enqueueRun(project.id, runOptions);
        await processJob((await claimJob())!, await deps());
        expect(await enqueueRerun(runId, repo.id, "security")).toBe("queued");
        expect(await enqueueRerun(runId, repo.id, "security")).toBe("already queued");
        expect(await prisma.job.count({ where: { runId, status: "queued" } })).toBe(1);
    });

    it("refuses a re-run while another run of the project is queued, and says so", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        const first = await enqueueRun(project.id, runOptions);
        await processJob((await claimJob())!, await deps());
        await enqueueRun(project.id, runOptions);
        await expect(enqueueRerun(first, repo.id, "security")).rejects.toBeInstanceOf(ActiveRunError);
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

    it("survives the database closing the LISTEN connection", async () => {
        const stop = await listen(() => {});
        await prisma.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = 'LISTEN run_events' AND pid <> pg_backend_pid()`;
        await new Promise(r => setTimeout(r, 300));
        await stop();
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

describe("runLoop", () => {
    const job = (id: string) => ({ id, runId: id, aspect: null, repositoryId: null, allowPastReserve: false });
    const loop = (o: {
        sweep?: () => Promise<unknown>;
        jobs: string[];
        process: (id: string) => Promise<void>;
        claims?: string[];
        markFailed?: (id: string) => Promise<unknown>;
    }) => {
        const queue = [...o.jobs];
        let claimed = 0;
        return runLoop({
            markInterrupted: o.sweep ?? (async () => 0),
            claimJob: async () => {
                claimed++;
                o.claims?.push("claim");
                const id = queue.shift();
                return id ? job(id) : null;
            },
            processJob: j => o.process(j.id),
            markFailed: j => (o.markFailed ? o.markFailed(j.id) : Promise.resolve()),
            sleep: async () => {},
            log: () => {},
            pollMs: 0,
            // Drain the queue, then one empty claim.
            keepGoing: () => claimed <= o.jobs.length
        });
    };

    it("keeps serving jobs after one of them throws", async () => {
        const done: string[] = [];
        await loop({
            jobs: ["a", "b"],
            process: async id => {
                if (id === "a") throw new Error("its project was deleted mid-run");
                done.push(id);
            }
        });
        expect(done).toEqual(["b"]);
    });

    it("marks a job that failed to record itself as failed once the database answers, so its project is not blocked", async () => {
        const marked: string[] = [];
        let refusals = 1;
        const done: string[] = [];
        await loop({
            jobs: ["a", "b"],
            process: async id => {
                if (id === "a") throw new Error("connection lost");
                done.push(id);
            },
            markFailed: async id => {
                if (refusals-- > 0) throw new Error("ECONNREFUSED");
                marked.push(id);
            }
        });
        expect(marked).toEqual(["a"]);
        expect(done).toEqual(["b"]);
    });

    it("retries the startup sweep until the database answers, and claims nothing before it", async () => {
        const calls: string[] = [];
        let failures = 2;
        await loop({
            sweep: async () => {
                calls.push("sweep");
                if (failures-- > 0) throw new Error("ECONNREFUSED");
            },
            jobs: [],
            process: async () => {},
            claims: calls
        });
        expect(calls.slice(0, 4)).toEqual(["sweep", "sweep", "sweep", "claim"]);
    });
});

const home = async () => vi.stubEnv("AUDITDESK_HOME", await mkdtemp(join(tmpdir(), "auditdesk-home-")));

describe("engineFor", () => {
    it("picks the SDK engine for a Claude plan run and the API engine for an API key run", async () => {
        await home();
        vi.stubEnv("AUDITDESK_REPLAY_MODEL", "");
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "t1");
        vi.stubEnv("ANTHROPIC_API_KEY", "k1");
        expect(((await engineFor("claude_plan", "/tmp/r")) as Engine).kind).toBe("sdk");
        expect(((await engineFor("api_key", "/tmp/r")) as Engine).kind).toBe("api");
    });

    it("names the missing credential instead of an engine", async () => {
        await home();
        vi.stubEnv("AUDITDESK_REPLAY_MODEL", "");
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
        vi.stubEnv("ANTHROPIC_API_KEY", "");
        await expect(engineFor("claude_plan", "/tmp/r")).resolves.toMatch(/No Claude plan token/);
        await expect(engineFor("api_key", "/tmp/r")).resolves.toMatch(/No API key/);
    });
});

it("fails a Claude plan run that has no token before cloning, and calls nothing", async () => {
    await home();
    vi.stubEnv("AUDITDESK_REPLAY_MODEL", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    const { project, repo } = await projectWithRepo(await makeSampleRepo());
    const runId = await enqueueRun(project.id, { ...runOptions, modelAccess: "claude_plan" });
    await processJob((await claimJob())!);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { calls: true } });
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/No Claude plan token/);
    expect(run.calls).toHaveLength(0);
    expect((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).commitSha).toBeNull();
});

it("does not start a Claude plan run above the 50% reserve, and runs it when the start was allowed", async () => {
    await home();
    const replay = join(await mkdtemp(join(tmpdir(), "replay-")), "model.json");
    await writeFile(replay, JSON.stringify([finish()]));
    vi.stubEnv("AUDITDESK_REPLAY_MODEL", replay);
    vi.stubEnv("AUDITDESK_SCANNER_REPLAY", "src/test/fixtures/scanners");
    vi.stubEnv("WORKSPACE_DIR", await mkdtemp(join(tmpdir(), "ws-")));
    await recordPlanUsage({ utilization: 0.6, resetsAt: Math.floor(Date.now() / 1000) + 3600 });
    const { project } = await projectWithRepo(await makeSampleRepo());
    const held = await enqueueRun(project.id, { ...runOptions, modelAccess: "claude_plan" });
    await processJob((await claimJob())!);
    const first = await prisma.run.findUniqueOrThrow({ where: { id: held }, include: { agents: true, calls: true } });
    expect(first).toMatchObject({ status: "failed", error: expect.stringMatching(/^Not started\. .*at 60%/) });
    expect(first.agents).toHaveLength(0);
    expect(first.calls).toHaveLength(0);

    const allowed = await enqueueRun(project.id, { ...runOptions, modelAccess: "claude_plan", allowPastReserve: true });
    await processJob((await claimJob())!);
    const second = await prisma.run.findUniqueOrThrow({ where: { id: allowed }, include: { agents: true, calls: true } });
    expect(second.agents.map(a => a.status)).toEqual(["done"]);
    expect(second.calls).toHaveLength(1);
}, 60_000);

// The review's Minor 3: the engine's own refusal comes after the pipeline cloned and superseded the aspect's findings.
it("refuses a Claude plan re-run above the 50% reserve before cloning, so the aspect's findings stay", async () => {
    await home();
    const { project, repo } = await projectWithRepo(await makeSampleRepo());
    const runId = await enqueueRun(project.id, { ...runOptions, modelAccess: "claude_plan" });
    await prisma.job.updateMany({ where: { runId }, data: { status: "done" } });
    await prisma.run.update({ where: { id: runId }, data: { status: "done" } });
    await new PrismaSink(runId, project.id).createFinding(sampleFinding(repo.id));
    await recordPlanUsage({ utilization: 0.6, resetsAt: Math.floor(Date.now() / 1000) + 3600 });
    await enqueueRerun(runId, repo.id, "security");
    await processJob((await claimJob())!);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/^Not started\. .*at 60%/);
    expect((await prisma.finding.findFirstOrThrow({ where: { projectId: project.id, source: "agent" } })).status).toBe("unreviewed");
    expect((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).commitSha).toBeNull();
});

// The review's Minor 5: engineFor threw outside processJob's try, so the run's end was recorded as "could not record its end".
it("fails a run whose credentials file other users can read, with the reason, as any other failure", async () => {
    await home();
    vi.stubEnv("AUDITDESK_REPLAY_MODEL", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    await saveCredential("claude_plan", "plan-token-wxyz");
    await chmod(credentialsPath(), 0o644);
    const { project } = await projectWithRepo(await makeSampleRepo());
    const runId = await enqueueRun(project.id, { ...runOptions, modelAccess: "claude_plan" });
    await processJob((await claimJob())!);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { events: true } });
    expect(run).toMatchObject({ status: "failed", error: expect.stringMatching(/chmod 600/) });
    expect(run.events.map(e => e.message)).toContainEqual(expect.stringMatching(/^Run failed: .*chmod 600/));
});

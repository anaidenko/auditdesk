import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import "server-only";

import { type AspectRunner, apiAspectRunner } from "@/engine/agent/run-aspect";
import { workspaceDir } from "@/engine/config";
import { resolveCredential } from "@/engine/credentials";
import { createClient } from "@/engine/model";
import { type AuditDeps, runAudit } from "@/engine/pipeline";
import { readPlanUsage, reserveRefusal } from "@/engine/plan-usage";
import { dockerRunner } from "@/engine/scanners/docker";
import { REPLAY_RULESETS, replayRunner } from "@/engine/scanners/replay";
import { RULESETS, fetchRulesets } from "@/engine/scanners/rulesets";
import { startFakeAnthropic } from "@/engine/sdk/fake-server";
import { sdkAspectRunner } from "@/engine/sdk/run-aspect-sdk";
import { SERVER } from "@/engine/sdk/tools";
import type { ModelAccess } from "@/engine/types";
import { prisma } from "@/server/db";
import { claimJob, markInterrupted } from "@/server/jobs";
import { PrismaSink } from "@/server/sink";

type Job = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

export interface Engine {
    kind: "api" | "sdk";
    runAspect: AspectRunner;
    close(): Promise<void>;
}

const noop = async () => {};

// Replayed runs: anything not for the fake server goes to a closed loopback port and fails.
const NOWHERE = { HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost" };

/** The run's engine, or why it cannot start. Replayed runs get the fake model on either engine. */
export async function engineFor(access: ModelAccess, runDir: string, o: { allowPastReserve?: boolean } = {}): Promise<Engine | string> {
    const replay = process.env.AUDITDESK_REPLAY_MODEL;
    if (replay && access === "api_key") return { kind: "api", runAspect: apiAspectRunner(createClient(null)), close: noop };
    if (replay) {
        const fake = await startFakeAnthropic(JSON.parse(await readFile(replay, "utf8")), { toolPrefix: `mcp__${SERVER}__` });
        const runAspect = sdkAspectRunner({ access, credential: "replay", runDir, baseUrl: fake.url, extraEnv: NOWHERE, ...o });
        return { kind: "sdk", runAspect, close: fake.close };
    }
    const credential = await resolveCredential(access);
    if (!credential)
        return access === "claude_plan"
            ? "No Claude plan token: run `claude setup-token`, then add it in Settings or .env.local."
            : "No API key: add it in Settings or .env.local.";
    return access === "api_key"
        ? { kind: "api", runAspect: apiAspectRunner(createClient(credential)), close: noop }
        : { kind: "sdk", runAspect: sdkAspectRunner({ access, credential, runDir, ...o }), close: noop };
}

export function defaultDeps(sink: PrismaSink, runAspect: AspectRunner): AuditDeps {
    const replay = process.env.AUDITDESK_SCANNER_REPLAY;
    return {
        sink,
        runAspect,
        scanners: replay ? replayRunner(replay) : dockerRunner(),
        fetchRulesets: replay ? async () => REPLAY_RULESETS : dir => fetchRulesets(RULESETS, dir),
        workspaceDir: workspaceDir(),
        checklistsDir: "checklists"
    };
}

export async function processJob(job: Job, deps?: (sink: PrismaSink) => AuditDeps): Promise<void> {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: job.runId }, include: { project: { include: { repositories: true } } } });
    const sink = new PrismaSink(run.id, run.projectId);
    const finish = async (status: "done" | "failed" | "stopped", error: string | null) => {
        await prisma.$transaction([
            prisma.job.update({
                where: { id: job.id },
                data: { status: status === "stopped" ? "done" : status, error, finishedAt: new Date() }
            }),
            prisma.run.update({ where: { id: run.id }, data: { status, error, finishedAt: new Date() } })
        ]);
        await sink.progress(
            status === "failed" ? `Run failed: ${error}` : status === "stopped" ? "Run stopped." : "Run done.",
            status === "failed" ? "error" : "info"
        );
    };
    if (!run.project.aiConsentAt) return finish("failed", "The client's AI consent is not recorded for this project.");
    // Before the clone: a re-run would otherwise supersede the aspect's findings and then not start (Task E.7a).
    const refusal = run.modelAccess === "claude_plan" ? reserveRefusal(await readPlanUsage(), job.allowPastReserve) : null;
    if (refusal) return finish("failed", `Not started. ${refusal} Start it again then, or allow it past the reserve.`);
    let engine: Engine | null = null;
    try {
        // No credential, no clone: the run fails before it touches the client's code.
        if (!deps) {
            const chosen = await engineFor(run.modelAccess, join(workspaceDir(), run.projectId, "runs", run.id), {
                allowPastReserve: job.allowPastReserve
            });
            if (typeof chosen === "string") return await finish("failed", chosen);
            engine = chosen;
        }
        await prisma.run.update({ where: { id: run.id }, data: { status: "running", startedAt: run.startedAt ?? new Date() } });
        const { stopped } = await runAudit(
            {
                runId: run.id,
                projectId: run.projectId,
                model: run.model,
                effort: run.effort as never,
                budget: { usd: Number(run.budgetUsd), tokens: run.budgetTokens },
                repositories: run.project.repositories.map(r => ({
                    id: r.id,
                    source: r.source,
                    branch: r.branch,
                    // A re-run audits the commit its own run audited; runs from before `commits` fall back to the latest clone.
                    sha: job.aspect ? ((run.commits as Record<string, string> | null)?.[r.id] ?? r.commitSha) : null
                })),
                aspects: run.aspects,
                only: job.aspect && job.repositoryId ? { repositoryId: job.repositoryId, aspect: job.aspect } : undefined
            },
            deps ? deps(sink) : defaultDeps(sink, engine!.runAspect)
        );
        await finish(stopped ? "stopped" : "done", null);
    } catch (e) {
        await finish("failed", (e as Error).message);
    } finally {
        await engine?.close();
    }
}

export interface LoopDeps {
    markInterrupted: () => Promise<unknown>;
    claimJob: () => Promise<Job | null>;
    processJob: (job: Job) => Promise<void>;
    /** Records a job that could not record its own end, so its run does not stay active. */
    markFailed: (job: Job, error: unknown) => Promise<unknown>;
    sleep: (ms: number) => Promise<unknown>;
    log: (message: string, error: unknown) => void;
    pollMs: number;
    /** Tests end the loop; the server's never does. */
    keepGoing?: () => boolean;
}

/**
 * Nothing may end this loop: if it died, every later run would wait in "queued" until a restart.
 * The startup sweep must succeed before the first claim, or a stale queued job would run unasked.
 */
export async function runLoop(d: LoopDeps): Promise<void> {
    const keepGoing = d.keepGoing ?? (() => true);
    for (;;) {
        try {
            await d.markInterrupted();
            break;
        } catch (e) {
            d.log("The startup sweep failed; retrying. Is the database up?", e);
            await d.sleep(d.pollMs);
        }
    }
    while (keepGoing()) {
        const job = await d.claimJob().catch(() => null);
        if (!job) {
            await d.sleep(d.pollMs);
            continue;
        }
        try {
            await d.processJob(job);
        } catch (e) {
            d.log(`Job ${job.id} ended with an error the run could not record.`, e);
            // Until this succeeds the run counts as active, and its project could start no other run.
            for (;;) {
                try {
                    await d.markFailed(job, e);
                    break;
                } catch (again) {
                    d.log(`Job ${job.id} could not be marked failed yet; retrying.`, again);
                    await d.sleep(d.pollMs);
                }
            }
        }
    }
}

async function markFailed(job: Job, error: unknown): Promise<void> {
    const message = `The run could not record its end: ${(error as Error).message}`;
    await prisma.$transaction([
        prisma.job.updateMany({
            where: { id: job.id, status: "running" },
            data: { status: "failed", error: message, finishedAt: new Date() }
        }),
        prisma.run.updateMany({
            where: { id: job.runId, status: { in: ["queued", "running"] } },
            data: { status: "failed", error: message, finishedAt: new Date() }
        })
    ]);
}

const g = globalThis as unknown as { auditdeskRunner?: boolean };

/** Started once per server process by instrumentation.ts; one job at a time in v1 (design § 5). */
export function startRunner(pollMs = 2000): void {
    if (g.auditdeskRunner) return;
    g.auditdeskRunner = true;
    void runLoop({
        markInterrupted,
        claimJob,
        processJob: job => processJob(job),
        markFailed,
        sleep,
        log: (message, error) => console.error(`[runner] ${message}`, error),
        pollMs
    });
}

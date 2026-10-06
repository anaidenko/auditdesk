import { setTimeout as sleep } from "node:timers/promises";
import "server-only";

import { workspaceDir } from "@/engine/config";
import { createClient } from "@/engine/model";
import { type AuditDeps, runAudit } from "@/engine/pipeline";
import { dockerRunner } from "@/engine/scanners/docker";
import { REPLAY_RULESETS, replayRunner } from "@/engine/scanners/replay";
import { RULESETS, fetchRulesets } from "@/engine/scanners/rulesets";
import { prisma } from "@/server/db";
import { claimJob, markInterrupted } from "@/server/jobs";
import { PrismaSink } from "@/server/sink";

type Job = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

export function defaultDeps(sink: PrismaSink): AuditDeps {
    const replay = process.env.AUDITDESK_SCANNER_REPLAY;
    return {
        sink,
        client: createClient(),
        scanners: replay ? replayRunner(replay) : dockerRunner(),
        fetchRulesets: replay ? async () => REPLAY_RULESETS : dir => fetchRulesets(RULESETS, dir),
        workspaceDir: workspaceDir(),
        checklistsDir: "checklists"
    };
}

export async function processJob(job: Job, deps: (sink: PrismaSink) => AuditDeps = defaultDeps): Promise<void> {
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
    await prisma.run.update({ where: { id: run.id }, data: { status: "running", startedAt: run.startedAt ?? new Date() } });
    try {
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
                    sha: job.aspect ? r.commitSha : null
                })),
                aspects: run.aspects,
                only: job.aspect && job.repositoryId ? { repositoryId: job.repositoryId, aspect: job.aspect } : undefined
            },
            deps(sink)
        );
        await finish(stopped ? "stopped" : "done", null);
    } catch (e) {
        await finish("failed", (e as Error).message);
    }
}

export interface LoopDeps {
    markInterrupted: () => Promise<unknown>;
    claimJob: () => Promise<Job | null>;
    processJob: (job: Job) => Promise<void>;
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
        }
    }
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
        sleep,
        log: (message, error) => console.error(`[runner] ${message}`, error),
        pollMs
    });
}

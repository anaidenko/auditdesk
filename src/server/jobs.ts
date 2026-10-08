import "server-only";

import type { ModelAccess } from "@/engine/types";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { RUN_CHANNEL } from "@/server/pg";

export class ActiveRunError extends Error {
    constructor() {
        super("A run is already queued or running for this project.");
    }
}

/** A re-run returns to its run's commit, and the report names one commit per repository: the latest run's. */
export class StaleRunError extends Error {
    constructor() {
        super("A newer run of this project exists: re-run the aspect from it, or start a new run.");
    }
}

/** The pipeline would skip every agent of a re-run whose run has spent its cap. */
export class SpentRunError extends Error {
    constructor() {
        super("This run has spent its cap: start a new run for this aspect.");
    }
}

export class AccessChangedError extends Error {
    constructor() {
        super("This run's model access differs from the project's now; start a new run.");
    }
}

export async function enqueueRun(
    projectId: string,
    o: {
        model: string;
        effort: string;
        modelAccess: ModelAccess;
        aspects: string[];
        budgetUsd: number;
        budgetTokens: number;
        allowPastReserve?: boolean;
    }
): Promise<string> {
    const { allowPastReserve = false, ...run } = o;
    try {
        return await prisma.$transaction(async tx => {
            const { id } = await tx.run.create({ data: { projectId, ...run } });
            await tx.job.create({ data: { runId: id, allowPastReserve } });
            return id;
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ActiveRunError();
        throw e;
    }
}

/** "already queued" is a second press; another active run in the project throws ActiveRunError. */
export async function enqueueRerun(
    runId: string,
    repositoryId: string,
    aspect: string,
    o: { allowPastReserve?: boolean } = {}
): Promise<"queued" | "already queued"> {
    try {
        return await prisma.$transaction(async tx => {
            const run = await tx.run.findUniqueOrThrow({
                where: { id: runId },
                select: { modelAccess: true, projectId: true, createdAt: true, budgetUsd: true, project: { select: { modelAccess: true } } }
            });
            // A run keeps its access; the project's switch speaks for new runs only (plan, Decision 1).
            if (run.modelAccess !== run.project.modelAccess) throw new AccessChangedError();
            if (await tx.run.count({ where: { projectId: run.projectId, createdAt: { gt: run.createdAt } } })) throw new StaleRunError();
            const spent = await tx.apiCall.aggregate({ where: { runId }, _sum: { costUsd: true } });
            if (Number(spent._sum.costUsd ?? 0) >= Number(run.budgetUsd)) throw new SpentRunError();
            // Only a finished run is re-queued: a second press would otherwise queue a second, paid job.
            const { count } = await tx.run.updateMany({
                where: { id: runId, status: { notIn: ["queued", "running"] } },
                data: { status: "queued", stopRequested: false, finishedAt: null }
            });
            if (!count) {
                await tx.run.findUniqueOrThrow({ where: { id: runId } });
                return "already queued";
            }
            await tx.job.create({ data: { runId, repositoryId, aspect, allowPastReserve: o.allowPastReserve ?? false } });
            return "queued";
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ActiveRunError();
        throw e;
    }
}

/** One job per caller, never the same one twice: FOR UPDATE SKIP LOCKED (design § 5). */
export async function claimJob(o: { runId?: string } = {}) {
    // `runId`: a script that runs its own run's job outside the server (scripts/sample-report.mts).
    const only = o.runId ? Prisma.sql`AND "runId" = ${o.runId}` : Prisma.empty;
    const rows = await prisma.$queryRaw<
        { id: string; runId: string; aspect: string | null; repositoryId: string | null; allowPastReserve: boolean }[]
    >`
        UPDATE "Job" SET status = 'running', "startedAt" = now()
        WHERE id = (
            SELECT id FROM "Job" WHERE status = 'queued' ${only}
            ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
        )
        RETURNING id, "runId", aspect, "repositoryId", "allowPastReserve"`;
    return rows[0] ?? null;
}

/**
 * On startup, work left running was cut off by a restart, and work left queued belongs to a
 * process that is gone (only the server enqueues). Both are marked, never run: a job that
 * crashes the process would loop and keep spending (design § 5), and a stale queued job would
 * spend money nobody approved on this start.
 */
export async function markInterrupted(): Promise<number> {
    const [jobs] = await prisma.$transaction([
        prisma.job.updateMany({
            where: { status: { in: ["running", "queued"] } },
            data: { status: "interrupted", finishedAt: new Date() }
        }),
        prisma.run.updateMany({
            where: { status: { in: ["running", "queued"] } },
            data: { status: "interrupted", finishedAt: new Date() }
        }),
        prisma.agentRun.updateMany({ where: { status: "running" }, data: { status: "stopped", note: "Interrupted by a server restart." } })
    ]);
    return jobs.count;
}

export async function requestStop(runId: string): Promise<void> {
    await prisma.$transaction([
        prisma.run.update({ where: { id: runId }, data: { stopRequested: true } }),
        prisma.$executeRaw`SELECT pg_notify(${RUN_CHANNEL}, ${runId})`
    ]);
}

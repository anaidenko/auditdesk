import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { RUN_CHANNEL } from "@/server/pg";

export class ActiveRunError extends Error {
    constructor() {
        super("A run is already queued or running for this project.");
    }
}

export async function enqueueRun(
    projectId: string,
    o: { model: string; effort: string; aspects: string[]; budgetUsd: number; budgetTokens: number }
): Promise<string> {
    try {
        return await prisma.$transaction(async tx => {
            const run = await tx.run.create({ data: { projectId, ...o } });
            await tx.job.create({ data: { runId: run.id } });
            return run.id;
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ActiveRunError();
        throw e;
    }
}

/** "already queued" is a second press; another active run in the project throws ActiveRunError. */
export async function enqueueRerun(runId: string, repositoryId: string, aspect: string): Promise<"queued" | "already queued"> {
    try {
        return await prisma.$transaction(async tx => {
            // Only a finished run is re-queued: a second press would otherwise queue a second, paid job.
            const { count } = await tx.run.updateMany({
                where: { id: runId, status: { notIn: ["queued", "running"] } },
                data: { status: "queued", stopRequested: false, finishedAt: null }
            });
            if (!count) {
                await tx.run.findUniqueOrThrow({ where: { id: runId } });
                return "already queued";
            }
            await tx.job.create({ data: { runId, repositoryId, aspect } });
            return "queued";
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ActiveRunError();
        throw e;
    }
}

/** One job per caller, never the same one twice: FOR UPDATE SKIP LOCKED (design § 5). */
export async function claimJob() {
    const rows = await prisma.$queryRaw<{ id: string; runId: string; aspect: string | null; repositoryId: string | null }[]>`
        UPDATE "Job" SET status = 'running', "startedAt" = now()
        WHERE id = (
            SELECT id FROM "Job" WHERE status = 'queued'
            ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
        )
        RETURNING id, "runId", aspect, "repositoryId"`;
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

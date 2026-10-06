import "server-only";

import type { ModelAccess } from "@/engine/types";
import { prisma } from "@/server/db";

export function listProjects() {
    return prisma.project.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { findings: true, runs: true } } } });
}

export function getProject(id: string) {
    return prisma.project.findUnique({
        where: { id },
        include: { repositories: { orderBy: { createdAt: "asc" } }, runs: { orderBy: { createdAt: "desc" } } }
    });
}

export interface RunSnapshot {
    status: string;
    modelAccess: ModelAccess;
    stopRequested: boolean;
    events: { id: string; level: string; message: string; at: string }[];
    agents: { id: string; aspect: string; status: string; note: string | null }[];
    spendUsd: number;
    unpriced: boolean;
    /** Per model that served calls, a fallback target included (design § 8). */
    byModel: { model: string; calls: number; freshTokens: number; usd: number; fallback: boolean }[];
    findings: number;
    terminal: boolean;
}

function byServingModel(
    calls: {
        costUsd: unknown;
        servedModel: string;
        fallback: boolean;
        inputTokens: number;
        cacheWrite5mTokens: number;
        cacheWrite1hTokens: number;
        outputTokens: number;
    }[]
): RunSnapshot["byModel"] {
    const rows = new Map<string, RunSnapshot["byModel"][number]>();
    for (const c of calls) {
        const row = rows.get(c.servedModel) ?? { model: c.servedModel, calls: 0, freshTokens: 0, usd: 0, fallback: false };
        row.calls++;
        row.freshTokens += c.inputTokens + c.cacheWrite5mTokens + c.cacheWrite1hTokens + c.outputTokens;
        row.usd = Math.round((row.usd + Number(c.costUsd ?? 0)) * 1e6) / 1e6;
        row.fallback ||= c.fallback;
        rows.set(c.servedModel, row);
    }
    return [...rows.values()];
}

export async function runSnapshot(runId: string, afterEventId: bigint): Promise<RunSnapshot> {
    const run = await prisma.run.findUniqueOrThrow({
        where: { id: runId },
        include: {
            events: { where: { id: { gt: afterEventId } }, orderBy: { id: "asc" } },
            agents: { orderBy: { createdAt: "asc" } },
            calls: {
                orderBy: { createdAt: "asc" },
                select: {
                    costUsd: true,
                    servedModel: true,
                    fallback: true,
                    inputTokens: true,
                    cacheWrite5mTokens: true,
                    cacheWrite1hTokens: true,
                    outputTokens: true
                }
            },
            _count: { select: { findings: true } }
        }
    });
    return {
        status: run.status,
        modelAccess: run.modelAccess,
        stopRequested: run.stopRequested,
        events: run.events.map(e => ({ id: e.id.toString(), level: e.level, message: e.message, at: e.createdAt.toISOString() })),
        agents: run.agents.map(a => ({ id: a.id, aspect: a.aspect, status: a.status, note: a.note })),
        spendUsd: run.calls.reduce((s, c) => s + Number(c.costUsd ?? 0), 0),
        unpriced: run.calls.some(c => c.costUsd === null),
        byModel: byServingModel(run.calls),
        findings: run._count.findings,
        terminal: ["done", "failed", "interrupted", "stopped"].includes(run.status)
    };
}

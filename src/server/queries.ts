import "server-only";

import { prisma } from "@/server/db";

export function listProjects() {
    return prisma.project.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { findings: true, runs: true } } } });
}

export function getProject(id: string) {
    return prisma.project.findUnique({ where: { id }, include: { repositories: true, runs: { orderBy: { createdAt: "desc" } } } });
}

export interface RunSnapshot {
    status: string;
    stopRequested: boolean;
    events: { id: string; level: string; message: string; at: string }[];
    agents: { id: string; aspect: string; status: string; note: string | null }[];
    spendUsd: number;
    unpriced: boolean;
    findings: number;
    terminal: boolean;
}

export async function runSnapshot(runId: string, afterEventId: bigint): Promise<RunSnapshot> {
    const run = await prisma.run.findUniqueOrThrow({
        where: { id: runId },
        include: {
            events: { where: { id: { gt: afterEventId } }, orderBy: { id: "asc" } },
            agents: { orderBy: { createdAt: "asc" } },
            calls: { select: { costUsd: true } },
            _count: { select: { findings: true } }
        }
    });
    return {
        status: run.status,
        stopRequested: run.stopRequested,
        events: run.events.map(e => ({ id: e.id.toString(), level: e.level, message: e.message, at: e.createdAt.toISOString() })),
        agents: run.agents.map(a => ({ id: a.id, aspect: a.aspect, status: a.status, note: a.note })),
        spendUsd: run.calls.reduce((s, c) => s + Number(c.costUsd ?? 0), 0),
        unpriced: run.calls.some(c => c.costUsd === null),
        findings: run._count.findings,
        terminal: ["done", "failed", "interrupted", "stopped"].includes(run.status)
    };
}

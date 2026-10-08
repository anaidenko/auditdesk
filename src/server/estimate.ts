import "server-only";

import { type CostStats, type PlanShareRate, costStats, shareRate, windowShare } from "@/engine/estimate";
import { MODEL_CHOICES } from "@/engine/models";
import { prisma } from "@/server/db";

/**
 * Per-agent cost by model and effort ("claude-sonnet-5-5/low"), from agents that finished with
 * every call priced; a pair with no such agent is absent, and `pickStats` falls back. An agent
 * whose cost reached its share stopped on its cap, so its cost is counted and marked as a lower bound.
 */
export async function agentCostStats(): Promise<Record<string, CostStats>> {
    const agents = await prisma.agentRun.findMany({
        where: { status: { in: ["done", "partial"] }, run: { model: { in: MODEL_CHOICES.map(m => m.id) } } },
        select: { usdShare: true, run: { select: { model: true, effort: true } }, calls: { select: { costUsd: true } } }
    });
    const byPair = new Map<string, { costs: number[]; capped: number }>();
    for (const a of agents) {
        if (!a.calls.length || a.calls.some(c => c.costUsd === null)) continue;
        const cost = a.calls.reduce((sum, c) => sum + Number(c.costUsd), 0);
        const key = `${a.run.model}/${a.run.effort}`;
        const pair = byPair.get(key) ?? { costs: [], capped: 0 };
        pair.costs.push(cost);
        if (cost >= 0.95 * Number(a.usdShare)) pair.capped++;
        byPair.set(key, pair);
    }
    return Object.fromEntries([...byPair].map(([key, p]) => [key, costStats(p.costs, 0, p.capped)]));
}

/**
 * The share of the plan's 5-hour window a dollar of API-equivalent cost takes, from every Claude plan
 * run's readings and the cost of its calls between them; null before a plan run moved the reading
 * twice. A reading belongs to the job that started last before it, so a re-run counts apart.
 */
export async function planShareRate(): Promise<PlanShareRate | null> {
    const runs = await prisma.run.findMany({
        where: { modelAccess: "claude_plan", planReadings: { some: {} } },
        select: {
            planReadings: { select: { utilization: true, resetsAt: true, createdAt: true }, orderBy: { id: "asc" } },
            calls: { select: { costUsd: true, createdAt: true } },
            jobs: { where: { startedAt: { not: null } }, select: { id: true, startedAt: true }, orderBy: { startedAt: "asc" } }
        }
    });
    return shareRate(
        runs.map(r =>
            windowShare(
                r.planReadings.map(p => ({
                    utilization: p.utilization,
                    resetsAt: p.resetsAt,
                    part: r.jobs.findLast(j => j.startedAt! <= p.createdAt)?.id ?? null,
                    at: p.createdAt
                })),
                r.calls.map(c => ({ costUsd: c.costUsd === null ? null : Number(c.costUsd), at: c.createdAt }))
            )
        )
    );
}

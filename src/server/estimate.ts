import "server-only";

import { type CostStats, costStats } from "@/engine/estimate";
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

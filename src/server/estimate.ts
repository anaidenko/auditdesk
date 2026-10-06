import "server-only";

import { BASELINE_USD, type CostStats, costStats } from "@/engine/estimate";
import { MODEL_CHOICES } from "@/engine/models";
import { prisma } from "@/server/db";

/** Each offered model's per-agent cost, from agents that finished with every call priced. */
export async function agentCostStats(): Promise<Record<string, CostStats>> {
    const agents = await prisma.agentRun.findMany({
        where: { status: { in: ["done", "partial"] }, run: { model: { in: MODEL_CHOICES.map(m => m.id) } } },
        select: { run: { select: { model: true } }, calls: { select: { costUsd: true } } }
    });
    const byModel = new Map<string, number[]>();
    for (const a of agents) {
        if (!a.calls.length || a.calls.some(c => c.costUsd === null)) continue;
        const list = byModel.get(a.run.model) ?? [];
        list.push(a.calls.reduce((sum, c) => sum + Number(c.costUsd), 0));
        byModel.set(a.run.model, list);
    }
    return Object.fromEntries(MODEL_CHOICES.map(m => [m.id, costStats(byModel.get(m.id) ?? [], BASELINE_USD[m.id] ?? 0)]));
}

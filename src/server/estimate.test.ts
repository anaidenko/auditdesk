import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { agentCostStats } from "@/server/estimate";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

beforeEach(resetDb);

async function agentWithCalls(runId: string, repositoryId: string, status: "done" | "partial" | "failed", costs: (number | null)[]) {
    const a = await prisma.agentRun.create({ data: { runId, repositoryId, aspect: "security", status, tokenShare: 20_000, usdShare: 1 } });
    for (const costUsd of costs) {
        await prisma.apiCall.create({
            data: {
                runId,
                agentRunId: a.id,
                requestedModel: "claude-sonnet-5-5",
                servedModel: "claude-sonnet-5-5",
                fallback: false,
                inputTokens: 1,
                cacheWrite5mTokens: 0,
                cacheWrite1hTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 1,
                costUsd
            }
        });
    }
}

describe("agentCostStats", () => {
    it("builds each model's per-agent range from finished agents, leaving out failed and unpriced ones", async () => {
        const { project, repo } = await projectWithRepo();
        const run = await prisma.run.create({
            data: {
                projectId: project.id,
                model: "claude-sonnet-5-5",
                effort: "low",
                aspects: ["security"],
                budgetUsd: 3,
                budgetTokens: 400_000
            }
        });
        await agentWithCalls(run.id, repo.id, "done", [0.05, 0.05]);
        await agentWithCalls(run.id, repo.id, "partial", [0.3]);
        await agentWithCalls(run.id, repo.id, "failed", [5]);
        await agentWithCalls(run.id, repo.id, "done", [0.2, null]);
        const stats = await agentCostStats();
        expect(stats["claude-sonnet-5-5"]).toEqual({ samples: 2, low: 0.1, high: 0.3 });
        expect(stats["claude-opus-5-5"]).toEqual({ samples: 0, low: 0.22, high: 2.2 });
    });
});

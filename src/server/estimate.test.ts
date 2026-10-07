import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { agentCostStats } from "@/server/estimate";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

beforeEach(resetDb);

async function agentWithCalls(
    runId: string,
    repositoryId: string,
    status: "done" | "partial" | "failed",
    costs: (number | null)[],
    usdShare = 1
) {
    const a = await prisma.agentRun.create({ data: { runId, repositoryId, aspect: "security", status, tokenShare: 20_000, usdShare } });
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
    it("builds each model and effort's per-agent range from finished agents, leaving out failed and unpriced ones", async () => {
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
        expect(stats["claude-sonnet-5-5/low"]).toEqual({ samples: 2, capped: 0, low: 0.2, high: 0.6, thin: true });
        expect(stats["claude-sonnet-5-5/high"]).toBeUndefined();
        expect(stats["claude-opus-5-5/low"]).toBeUndefined();
    });

    it("counts an agent whose cost reached its share as capped", async () => {
        const { project, repo } = await projectWithRepo();
        const run = await prisma.run.create({
            data: {
                projectId: project.id,
                model: "claude-opus-5-5",
                effort: "high",
                aspects: ["security"],
                budgetUsd: 2,
                budgetTokens: 400_000
            }
        });
        await agentWithCalls(run.id, repo.id, "partial", [0.26], 0.25);
        await agentWithCalls(run.id, repo.id, "done", [0.1], 0.25);
        expect((await agentCostStats())["claude-opus-5-5/high"]).toMatchObject({ samples: 2, capped: 1 });
    });
});

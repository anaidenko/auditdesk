import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { runSnapshot } from "@/server/queries";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

beforeEach(resetDb);

describe("runSnapshot", () => {
    it("shows dollars and fresh tokens per serving model, a fallback call under the model that served it", async () => {
        const { project } = await projectWithRepo();
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
        const call = (servedModel: string, costUsd: number, fallback = false) =>
            prisma.apiCall.create({
                data: {
                    runId: run.id,
                    requestedModel: "claude-sonnet-5-5",
                    servedModel,
                    fallback,
                    inputTokens: 100,
                    cacheWrite5mTokens: 0,
                    cacheWrite1hTokens: 1000,
                    cacheReadTokens: 5000,
                    outputTokens: 200,
                    costUsd
                }
            });
        await call("claude-sonnet-5-5", 0.1);
        await call("claude-sonnet-5-5", 0.2);
        await call("claude-sonnet-5", 0.05, true);
        const snap = await runSnapshot(run.id, BigInt(0));
        expect(snap.byModel).toEqual([
            { model: "claude-sonnet-5-5", calls: 2, freshTokens: 2600, usd: 0.3, fallback: false, unpriced: false },
            { model: "claude-sonnet-5", calls: 1, freshTokens: 1300, usd: 0.05, fallback: true, unpriced: false }
        ]);
    });
});

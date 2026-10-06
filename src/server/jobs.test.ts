import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { AccessChangedError, enqueueRerun, enqueueRun } from "@/server/jobs";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

beforeEach(resetDb);

const RUN = { model: "claude-sonnet-5-5", effort: "low", aspects: ["security"], budgetUsd: 3, budgetTokens: 400_000 };

describe("model access on runs", () => {
    it("a run records the access its project had when it was queued", async () => {
        const { project } = await projectWithRepo();
        await prisma.project.update({ where: { id: project.id }, data: { modelAccess: "api_key" } });
        const runId = await enqueueRun(project.id, { ...RUN, modelAccess: "api_key" });
        expect((await prisma.run.findUniqueOrThrow({ where: { id: runId } })).modelAccess).toBe("api_key");
    });

    it("refuses to re-run an aspect after the project's access changed", async () => {
        const { project, repo } = await projectWithRepo();
        const runId = await enqueueRun(project.id, { ...RUN, modelAccess: "claude_plan" });
        await prisma.run.update({ where: { id: runId }, data: { status: "done" } });
        await prisma.project.update({ where: { id: project.id }, data: { modelAccess: "api_key" } });
        await expect(enqueueRerun(runId, repo.id, "security")).rejects.toBeInstanceOf(AccessChangedError);
        await prisma.project.update({ where: { id: project.id }, data: { modelAccess: "claude_plan" } });
        await expect(enqueueRerun(runId, repo.id, "security")).resolves.toBe("queued");
    });
});

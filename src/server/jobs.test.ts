import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { AccessChangedError, SpentRunError, StaleRunError, claimJob, enqueueRerun, enqueueRun } from "@/server/jobs";
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

    it("keeps a start's permission past the 50% reserve on its job; a re-run asks again", async () => {
        const { project, repo } = await projectWithRepo();
        const runId = await enqueueRun(project.id, { ...RUN, modelAccess: "claude_plan", allowPastReserve: true });
        await prisma.run.update({ where: { id: runId }, data: { status: "done" } });
        await enqueueRerun(runId, repo.id, "security");
        await prisma.run.update({ where: { id: runId }, data: { status: "done" } });
        await enqueueRerun(runId, repo.id, "security", { allowPastReserve: true });
        const jobs = await prisma.job.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
        expect(jobs.map(j => j.allowPastReserve)).toEqual([true, false, true]);
    });
});

describe("claimJob", () => {
    it("claims only the named run's job when asked, leaving an older one queued", async () => {
        const older = await projectWithRepo();
        const olderRun = await enqueueRun(older.project.id, { ...RUN, modelAccess: "claude_plan" });
        const mine = await projectWithRepo();
        const myRun = await enqueueRun(mine.project.id, { ...RUN, modelAccess: "claude_plan" });
        expect((await claimJob({ runId: myRun }))?.runId).toBe(myRun);
        expect((await prisma.job.findFirstOrThrow({ where: { runId: olderRun } })).status).toBe("queued");
        expect(await claimJob({ runId: myRun })).toBeNull();
    });
});

describe("re-runs", () => {
    it("are offered on the project's latest run only: an older run's would take the report back to its commit", async () => {
        const { project, repo } = await projectWithRepo();
        const older = await enqueueRun(project.id, { ...RUN, modelAccess: "claude_plan" });
        await prisma.run.update({ where: { id: older }, data: { status: "done", createdAt: new Date(Date.now() - 60_000) } });
        const newer = await enqueueRun(project.id, { ...RUN, modelAccess: "claude_plan" });
        await prisma.run.update({ where: { id: newer }, data: { status: "done" } });
        await expect(enqueueRerun(older, repo.id, "security")).rejects.toBeInstanceOf(StaleRunError);
        expect(await prisma.job.count({ where: { runId: older } })).toBe(1);
        await expect(enqueueRerun(newer, repo.id, "security")).resolves.toBe("queued");
    });

    it("are refused once the run has spent its cap, since its agents would only be skipped", async () => {
        const { project, repo } = await projectWithRepo();
        const runId = await enqueueRun(project.id, { ...RUN, modelAccess: "claude_plan" });
        await prisma.run.update({ where: { id: runId }, data: { status: "done" } });
        const call = {
            runId,
            requestedModel: "m",
            servedModel: "m",
            fallback: false,
            inputTokens: 1,
            cacheWrite5mTokens: 0,
            cacheWrite1hTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 1
        };
        await prisma.apiCall.create({ data: { ...call, costUsd: 2.5 } });
        await expect(enqueueRerun(runId, repo.id, "security")).resolves.toBe("queued");
        await prisma.run.update({ where: { id: runId }, data: { status: "done" } });
        await prisma.apiCall.create({ data: { ...call, costUsd: 0.5 } });
        await expect(enqueueRerun(runId, repo.id, "security")).rejects.toBeInstanceOf(SpentRunError);
    });
});

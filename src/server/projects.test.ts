import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { ActiveRunError, enqueueRun } from "@/server/jobs";
import { deleteProject, detectRepositoryStack, saveRepositoryNotes } from "@/server/projects";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";
import { makeSampleRepo } from "@/test/sample-repo";

beforeEach(resetDb);

const runOptions = {
    model: "m",
    effort: "low",
    modelAccess: "claude_plan" as const,
    aspects: ["security"],
    budgetUsd: 1,
    budgetTokens: 20_000
};

describe("deleteProject", () => {
    it("deletes the project and its clones", async () => {
        const { project } = await projectWithRepo();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        await mkdir(join(ws, project.id), { recursive: true });
        await deleteProject(project.id, ws);
        expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
        expect(existsSync(join(ws, project.id))).toBe(false);
    });

    it("refuses while a run is queued or running, and keeps the clones it reads", async () => {
        const { project } = await projectWithRepo();
        await enqueueRun(project.id, runOptions);
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        await mkdir(join(ws, project.id), { recursive: true });
        await expect(deleteProject(project.id, ws)).rejects.toBeInstanceOf(ActiveRunError);
        expect(await prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull();
        expect(existsSync(join(ws, project.id))).toBe(true);
    });
});

describe("a repository's stack and instructions", () => {
    it("detects the stack from a fresh clone of the branch, without touching the audited commit", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        const profile = await detectRepositoryStack(project.id, repo.id, ws);
        expect(profile.frameworks.join()).toMatch(/Express/);
        const after = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(after.stack).toEqual(profile);
        expect(after.commitSha).toBeNull();
        expect(await readdir(join(ws, project.id))).toEqual([]);
    });

    it("refuses to detect while a run is queued or running", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        await enqueueRun(project.id, runOptions);
        await expect(detectRepositoryStack(project.id, repo.id, await mkdtemp(join(tmpdir(), "ws-")))).rejects.toThrow(ActiveRunError);
    });

    it("confirms a written stack profile, and an emptied one goes back to detection", async () => {
        const { repo } = await projectWithRepo();
        await saveRepositoryNotes(repo.id, { stackText: "Next.js 16 and Prisma.", instructions: "pnpm dev" });
        let r = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(r).toMatchObject({ stackText: "Next.js 16 and Prisma.", instructions: "pnpm dev" });
        expect(r.stackConfirmedAt).toBeInstanceOf(Date);
        await saveRepositoryNotes(repo.id, { stackText: "", instructions: "" });
        r = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(r).toMatchObject({ stackText: null, stackConfirmedAt: null, instructions: null });
    });
});

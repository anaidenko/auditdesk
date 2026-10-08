import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { git } from "@/engine/git";
import { prisma } from "@/server/db";
import { ActiveRunError, enqueueRun } from "@/server/jobs";
import {
    confirmDetectedStack,
    createRepository,
    deleteProject,
    detectRepositoryStack,
    saveRepositoryNotes,
    setRepositoryBranch
} from "@/server/projects";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";
import { makeRepo } from "@/test/git-repo";
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
        expect(after.stackDetectedAt).toBeInstanceOf(Date);
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
        await saveRepositoryNotes(repo.id, { stackText: "Next.js 16 and Prisma.", instructions: "pnpm dev", confirm: true });
        let r = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(r).toMatchObject({ stackText: "Next.js 16 and Prisma.", instructions: "pnpm dev" });
        expect(r.stackConfirmedAt).toBeInstanceOf(Date);
        await saveRepositoryNotes(repo.id, { stackText: "", instructions: "", confirm: true });
        r = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(r).toMatchObject({ stackText: null, stackConfirmedAt: null, instructions: null });
    });

    it("saves the instructions alone without confirming a profile Andrii has not read", async () => {
        const { repo } = await projectWithRepo();
        await saveRepositoryNotes(repo.id, { stackText: "Detected text he never read.", instructions: "pnpm dev", confirm: false });
        const r = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(r).toMatchObject({ instructions: "pnpm dev", stackText: null, stackConfirmedAt: null });
    });

    it("confirms the latest detection as the profile, in one step", async () => {
        const { project, repo } = await projectWithRepo(await makeSampleRepo());
        await saveRepositoryNotes(repo.id, { stackText: "Old and stale.", instructions: null, confirm: true });
        await detectRepositoryStack(project.id, repo.id, await mkdtemp(join(tmpdir(), "ws-")));
        await confirmDetectedStack(repo.id);
        const r = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(r.stackText).toMatch(/^Languages: .*\nFrameworks: Express/);
        expect(r.stackConfirmedAt).toBeInstanceOf(Date);
    });
});

describe("the repositories of a project", () => {
    it("takes the repository's own default branch when the branch is left empty", async () => {
        const project = await prisma.project.create({ data: { name: "Acme" } });
        const source = await makeRepo({ "a.txt": "a" });
        await git(["branch", "-q", "-m", "main", "master"], source);
        expect((await createRepository(project.id, source, "")).branch).toBe("master");
        expect((await createRepository(project.id, source, "release")).branch).toBe("release");
    });

    it("falls back to main when the default branch cannot be read", async () => {
        const project = await prisma.project.create({ data: { name: "Acme" } });
        expect((await createRepository(project.id, "/nowhere/app", "")).branch).toBe("main");
    });

    it("changes a repository's branch in place, keeping its findings, but not while a run is queued or running", async () => {
        const { project, repo } = await projectWithRepo();
        await setRepositoryBranch(repo.id, "master");
        expect((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).branch).toBe("master");
        await expect(setRepositoryBranch(repo.id, "--upload-pack=x")).rejects.toThrow(/Not a branch name/);
        await enqueueRun(project.id, runOptions);
        await expect(setRepositoryBranch(repo.id, "main")).rejects.toThrow(/queued or running/);
    });
});

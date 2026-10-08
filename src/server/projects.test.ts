import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { git } from "@/engine/git";
import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { ActiveRunError, enqueueRun } from "@/server/jobs";
import {
    confirmDetectedStack,
    createRepository,
    deleteProject,
    deleteRepository,
    detectRepositoryStack,
    saveRepositoryNotes,
    setRepositoryBranch
} from "@/server/projects";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";
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
        const withRelease = await makeRepo({ "a.txt": "a" }, { branches: { release: { "r.txt": "r" } } });
        expect((await createRepository(project.id, withRelease, "release")).branch).toBe("release");
    });

    it("refuses a source it cannot read, in git's own words, and a branch the source does not have", async () => {
        const project = await prisma.project.create({ data: { name: "Acme" } });
        await expect(createRepository(project.id, "/nowhere/app", "")).rejects.toThrow(/^Could not read \/nowhere\/app: .+/);
        await expect(createRepository(project.id, await makeRepo({ "a.txt": "a" }), "develop")).rejects.toThrow(
            /Branch "develop" was not found/
        );
        expect(await prisma.repository.count({ where: { projectId: project.id } })).toBe(0);
    });

    it("removes a repository's clones with it, leaving the other repositories' alone", async () => {
        const { project } = await projectWithRepo();
        const spare = await prisma.repository.create({ data: { projectId: project.id, source: "/tmp/spare", branch: "main" } });
        const workspaceDir = await mkdtemp(join(tmpdir(), "ws-"));
        const dir = join(workspaceDir, project.id);
        for (const d of [`${spare.id}@abc`, `${spare.id}.cloning`, "other@abc"]) await mkdir(join(dir, d), { recursive: true });
        await deleteRepository(spare.id, workspaceDir);
        expect(await readdir(dir)).toEqual(["other@abc"]);
    });

    it("keeps a repository that a seams finding cites by its path name, though it has no findings of its own", async () => {
        const { project, repo } = await projectWithRepo("/tmp/web");
        await prisma.repository.create({
            data: { projectId: project.id, source: "/tmp/api", branch: "main", createdAt: new Date(Date.now() + 1000) }
        });
        const seam = await createFinding(project.id, null, {
            ...sampleFinding(repo.id, { aspect: "seams", evidence: [{ file: "web/src/client.ts", startLine: 1, endLine: 2 }] }),
            repositoryId: null
        });
        expect(seam.label).toBeTruthy();
        await expect(deleteRepository(repo.id, await mkdtemp(join(tmpdir(), "ws-")))).rejects.toThrow(/seams finding/);
    });

    it("removes a repository that has no findings, and refuses one that has, or any while a run is queued or running", async () => {
        const { project, repo } = await projectWithRepo();
        const spare = await prisma.repository.create({ data: { projectId: project.id, source: "/tmp/spare", branch: "main" } });
        await createFinding(project.id, null, sampleFinding(repo.id, {}));
        await expect(deleteRepository(repo.id, await mkdtemp(join(tmpdir(), "ws-")))).rejects.toThrow(/has findings/);
        const runId = await enqueueRun(project.id, runOptions);
        await expect(deleteRepository(spare.id, await mkdtemp(join(tmpdir(), "ws-")))).rejects.toThrow(/queued or running/);
        await prisma.run.update({ where: { id: runId }, data: { status: "done" } });
        await deleteRepository(spare.id, await mkdtemp(join(tmpdir(), "ws-")));
        expect(await prisma.repository.findMany({ where: { projectId: project.id }, select: { id: true } })).toEqual([{ id: repo.id }]);
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

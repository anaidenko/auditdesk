import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { ActiveRunError, enqueueRun } from "@/server/jobs";
import { deleteProject } from "@/server/projects";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

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

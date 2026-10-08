import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import "server-only";

import { pathNames } from "@/engine/pipeline";
import { type StackProfile, detectStack, stackProfileText } from "@/engine/stack";
import { deleteProjectClones, isBranchName, readRemote, withScratchClone } from "@/engine/workspace";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { ActiveRunError } from "@/server/jobs";

export async function hasActiveRun(projectId: string): Promise<boolean> {
    return (await prisma.run.count({ where: { projectId, status: { in: ["queued", "running"] } } })) > 0;
}

/**
 * Added only once git can read the source, and the branch when one is named; a branch left empty
 * is the one the source's HEAD names ("main" when HEAD names none).
 */
export async function createRepository(projectId: string, source: string, branch: string) {
    const { head } = await readRemote(source, branch);
    return prisma.repository.create({ data: { projectId, source, branch: branch || head || "main" } });
}

/**
 * A repository added by mistake, or taken away by the client, while no finding cites it: findings
 * are the audit's record, and a seams finding cites it by its path name. Its clones go with it.
 */
export async function deleteRepository(repositoryId: string, workspaceDir: string): Promise<void> {
    const repo = await prisma.repository.findUniqueOrThrow({
        where: { id: repositoryId },
        select: { projectId: true, _count: { select: { findings: true } } }
    });
    if (repo._count.findings) throw new Error("This repository has findings, the audit's record: it stays.");
    const prefix = `${pathNames(await prisma.repository.findMany({ where: { projectId: repo.projectId }, orderBy: { createdAt: "asc" } })).get(repositoryId)}/`;
    const seams = await prisma.finding.findMany({ where: { projectId: repo.projectId, repositoryId: null }, select: { evidence: true } });
    if (seams.some(f => (f.evidence as { file: string }[]).some(e => e.file.startsWith(prefix))))
        throw new Error("A seams finding cites this repository, the audit's record: it stays.");
    if (await hasActiveRun(repo.projectId)) throw new ActiveRunError();
    await prisma.repository.delete({ where: { id: repositoryId } });
    const dir = join(workspaceDir, repo.projectId);
    for (const name of await readdir(dir).catch(() => []))
        if (name.startsWith(`${repositoryId}@`) || name === `${repositoryId}.cloning`)
            await rm(join(dir, name), { recursive: true, force: true });
}

/**
 * The branch the project's next runs clone, changed in place so the repository keeps its findings, IDs
 * and re-checks: the client may have renamed or deleted the branch the audit began on. Refused during
 * a run, which clones the branch it started with.
 */
export async function setRepositoryBranch(repositoryId: string, branch: string): Promise<void> {
    if (!isBranchName(branch)) throw new Error(`Not a branch name: ${branch}`);
    const { projectId } = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId }, select: { projectId: true } });
    if (await hasActiveRun(projectId)) throw new ActiveRunError();
    await prisma.repository.update({ where: { id: repositoryId }, data: { branch } });
}

/** Refused during a run: the runner reads the clones and writes the run's rows until it ends. */
export async function deleteProject(projectId: string, workspaceDir: string): Promise<void> {
    if (await hasActiveRun(projectId)) throw new ActiveRunError();
    await deleteProjectClones(workspaceDir, projectId);
    await prisma.project.delete({ where: { id: projectId } });
}

/**
 * Detects the branch's stack as it is now, from a clone of its own, so Andrii can confirm it before
 * the first run. The audited commit and the run's clones are left alone.
 */
export async function detectRepositoryStack(projectId: string, repositoryId: string, workspaceDir: string): Promise<StackProfile> {
    if (await hasActiveRun(projectId)) throw new ActiveRunError();
    const repo = await prisma.repository.findFirstOrThrow({ where: { id: repositoryId, projectId } });
    const profile = await withScratchClone({ source: repo.source, branch: repo.branch, workspaceDir, projectId }, detectStack);
    await prisma.repository.update({
        where: { id: repositoryId },
        data: { stack: profile as unknown as Prisma.InputJsonObject, stackDetectedAt: new Date() }
    });
    return profile;
}

/**
 * Saves the instructions, and with `confirm` the stack profile as written: the confirmed one, or,
 * when emptied, a return to detection at the next run.
 */
export async function saveRepositoryNotes(
    repositoryId: string,
    v: { stackText: string | null; instructions: string | null; confirm: boolean }
): Promise<void> {
    const stackText = v.stackText?.trim() || null;
    await prisma.repository.update({
        where: { id: repositoryId },
        data: {
            instructions: v.instructions?.trim() || null,
            ...(v.confirm && { stackText, stackConfirmedAt: stackText ? new Date() : null })
        }
    });
}

/** Takes the latest detection as the confirmed profile, in place of an older confirmed text. */
export async function confirmDetectedStack(repositoryId: string): Promise<void> {
    const repo = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } });
    if (!repo.stack) throw new Error("Detect the stack first.");
    await prisma.repository.update({
        where: { id: repositoryId },
        data: { stackText: stackProfileText(repo.stack as unknown as StackProfile), stackConfirmedAt: new Date() }
    });
}

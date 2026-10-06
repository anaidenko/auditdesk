import "server-only";

import { type StackProfile, detectStack } from "@/engine/stack";
import { cloneRepository, deleteProjectClones } from "@/engine/workspace";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { ActiveRunError } from "@/server/jobs";

export async function hasActiveRun(projectId: string): Promise<boolean> {
    return (await prisma.run.count({ where: { projectId, status: { in: ["queued", "running"] } } })) > 0;
}

/** Refused during a run: the runner reads the clones and writes the run's rows until it ends. */
export async function deleteProject(projectId: string, workspaceDir: string): Promise<void> {
    if (await hasActiveRun(projectId)) throw new ActiveRunError();
    await deleteProjectClones(workspaceDir, projectId);
    await prisma.project.delete({ where: { id: projectId } });
}

/**
 * Clones the branch as it is now and detects its stack, so Andrii can confirm it before the first
 * run. The audited commit is left alone: only a run records one.
 */
export async function detectRepositoryStack(projectId: string, repositoryId: string, workspaceDir: string): Promise<StackProfile> {
    if (await hasActiveRun(projectId)) throw new ActiveRunError();
    const repo = await prisma.repository.findFirstOrThrow({ where: { id: repositoryId, projectId } });
    const { clonePath } = await cloneRepository({ source: repo.source, branch: repo.branch, workspaceDir, projectId, repositoryId });
    const profile = await detectStack(clonePath);
    await prisma.repository.update({ where: { id: repositoryId }, data: { stack: profile as unknown as Prisma.InputJsonObject } });
    return profile;
}

/** A written stack profile is the confirmed one; an empty one sends the next run back to detection. */
export async function saveRepositoryNotes(
    repositoryId: string,
    v: { stackText: string | null; instructions: string | null }
): Promise<void> {
    const stackText = v.stackText?.trim() || null;
    await prisma.repository.update({
        where: { id: repositoryId },
        data: { stackText, stackConfirmedAt: stackText ? new Date() : null, instructions: v.instructions?.trim() || null }
    });
}

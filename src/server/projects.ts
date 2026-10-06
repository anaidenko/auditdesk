import "server-only";

import { type StackProfile, detectStack } from "@/engine/stack";
import { deleteProjectClones, withScratchClone } from "@/engine/workspace";
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
 * Detects the branch's stack as it is now, from a clone of its own, so Andrii can confirm it before
 * the first run. The audited commit and the run's clones are left alone.
 */
export async function detectRepositoryStack(projectId: string, repositoryId: string, workspaceDir: string): Promise<StackProfile> {
    if (await hasActiveRun(projectId)) throw new ActiveRunError();
    const repo = await prisma.repository.findFirstOrThrow({ where: { id: repositoryId, projectId } });
    const profile = await withScratchClone({ source: repo.source, branch: repo.branch, workspaceDir, projectId }, detectStack);
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

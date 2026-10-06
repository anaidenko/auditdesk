import "server-only";

import { deleteProjectClones } from "@/engine/workspace";
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

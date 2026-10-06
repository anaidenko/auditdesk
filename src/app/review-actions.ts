"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SeverityName } from "@/engine/types";
import { prisma } from "@/server/db";
import { enqueueRerun } from "@/server/jobs";
import { accept, edit, exclude, merge, reject } from "@/server/review";

async function listPath(id: string) {
    const f = await prisma.finding.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
    return `/projects/${f.projectId}/findings`;
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optional = (fd: FormData, k: string) => text(fd, k) || null;

export async function acceptAction(id: string) {
    await accept(id);
    revalidatePath(await listPath(id));
}

export async function rejectAction(id: string, fd: FormData) {
    await reject(id, text(fd, "reason"));
    revalidatePath(await listPath(id));
}

export async function excludeAction(id: string, fd: FormData) {
    await exclude(id, text(fd, "reason"));
    revalidatePath(await listPath(id));
}

export async function editAction(id: string, fd: FormData) {
    const hours = optional(fd, "effortHours");
    await edit(id, {
        title: text(fd, "title"),
        severity: optional(fd, "severity") as SeverityName | null,
        likelihood: optional(fd, "likelihood"),
        impact: optional(fd, "impact"),
        summary: text(fd, "summary"),
        explanation: text(fd, "explanation"),
        recommendation: text(fd, "recommendation"),
        effort: optional(fd, "effort") as "S" | "M" | "L" | null,
        effortHours: hours ? Number(hours) : null,
        note: optional(fd, "note")
    });
    redirect(await listPath(id));
}

export async function mergeAction(id: string, fd: FormData) {
    await merge(id, text(fd, "target"));
    redirect(await listPath(id));
}

/** Unreviewed findings of the aspect are superseded, their IDs left as gaps; reviewed ones reach the agent as known (design § 9). */
export async function rerunAspect(runId: string, repositoryId: string, aspect: string) {
    await enqueueRerun(runId, repositoryId, aspect);
    redirect(`/runs/${runId}`);
}

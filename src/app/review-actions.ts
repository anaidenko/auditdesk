"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/actions";
import type { SeverityName } from "@/engine/types";
import { prisma } from "@/server/db";
import { ActiveRunError, enqueueRerun } from "@/server/jobs";
import { accept, edit, exclude, merge, reject } from "@/server/review";

async function listPath(id: string) {
    const f = await prisma.finding.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
    return `/projects/${f.projectId}/findings`;
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optional = (fd: FormData, k: string) => text(fd, k) || null;

/** A refusal (no reason given, a merge target that left the review) comes back as text for the form. */
async function refusal(work: () => Promise<void>): Promise<FormState> {
    try {
        await work();
        return { error: null };
    } catch (e) {
        return { error: (e as Error).message };
    }
}

export async function acceptAction(id: string, _prev: FormState, _fd: FormData): Promise<FormState> {
    const r = await refusal(() => accept(id));
    revalidatePath(await listPath(id));
    return r;
}

export async function rejectAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const r = await refusal(() => reject(id, text(fd, "reason")));
    revalidatePath(await listPath(id));
    return r;
}

export async function excludeAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const r = await refusal(() => exclude(id, text(fd, "reason")));
    revalidatePath(await listPath(id));
    return r;
}

export async function editAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const hours = optional(fd, "effortHours");
    const r = await refusal(() =>
        edit(id, {
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
        })
    );
    if (r.error) return r;
    redirect(await listPath(id));
}

export async function mergeAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const r = await refusal(() => merge(id, text(fd, "target")));
    if (r.error) return r;
    redirect(await listPath(id));
}

/** Unreviewed findings of the aspect are superseded, their IDs left as gaps; reviewed ones reach the agent as known (design § 9). */
export async function rerunAspect(runId: string, repositoryId: string, aspect: string) {
    let notice = "";
    try {
        await enqueueRerun(runId, repositoryId, aspect);
    } catch (e) {
        if (!(e instanceof ActiveRunError)) throw e;
        notice = "?notice=busy";
    }
    redirect(`/runs/${runId}${notice}`);
}

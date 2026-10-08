"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/actions";
import { hoursFrom } from "@/engine/effort";
import { readPlanUsage, reserveRefusal } from "@/engine/plan-usage";
import type { SeverityName } from "@/engine/types";
import { prisma } from "@/server/db";
import { AccessChangedError, ActiveRunError, SpentRunError, StaleRunError, enqueueRerun } from "@/server/jobs";
import { accept, confirmRecheck, edit, exclude, merge, reject } from "@/server/review";

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

export async function confirmRecheckAction(id: string, status: "fixed" | "open", _prev: FormState, _fd: FormData): Promise<FormState> {
    const r = await refusal(() => confirmRecheck(id, status));
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
            effortHours: hoursFrom(optional(fd, "effortHoursLow"), optional(fd, "effortHoursHigh")),
            fixBeforeSignoff: { before: true, later: false }[text(fd, "signoff")] ?? null,
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
export async function rerunAspect(runId: string, repositoryId: string, aspect: string, fd?: FormData) {
    const allowPastReserve = fd?.get("allowPastReserve") === "on";
    const { modelAccess } = await prisma.run.findUniqueOrThrow({ where: { id: runId }, select: { modelAccess: true } });
    if (modelAccess === "claude_plan" && reserveRefusal(await readPlanUsage(), allowPastReserve)) redirect(`/runs/${runId}?notice=reserve`);
    let notice = "";
    try {
        await enqueueRerun(runId, repositoryId, aspect, { allowPastReserve });
    } catch (e) {
        if (e instanceof ActiveRunError) notice = "?notice=busy";
        else if (e instanceof AccessChangedError) notice = "?notice=access";
        else if (e instanceof StaleRunError) notice = "?notice=stale";
        else if (e instanceof SpentRunError) notice = "?notice=spent";
        else throw e;
    }
    redirect(`/runs/${runId}${notice}`);
}

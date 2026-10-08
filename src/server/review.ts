import "server-only";

import { ASPECTS } from "@/engine/aspects";
import { hoursError, sizeOf } from "@/engine/effort";
import { compareFindings, findingLabel } from "@/engine/findings";
import { pathNames } from "@/engine/pipeline";
import type { Evidence, Hours, SeverityName } from "@/engine/types";
import type { Prisma } from "@/generated/prisma/client";
import { FindingStatus, RecheckStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

export const REPORTABLE = ["accepted", "edited"] as const;

export interface EditableFields {
    title?: string;
    fixBeforeSignoff?: boolean | null;
    severity?: SeverityName | null;
    likelihood?: string | null;
    impact?: string | null;
    summary?: string;
    explanation?: string;
    recommendation?: string;
    effort?: "S" | "M" | "L" | null;
    /** Null clears the hours; set, they decide the size. */
    effortHours?: Hours | null;
    note?: string | null;
}

/** A merged or superseded finding has left the review; acting on it would bring a duplicate back. */
async function reviewable(id: string) {
    const f = await prisma.finding.findUniqueOrThrow({ where: { id } });
    if (f.status === "merged" || f.status === "superseded")
        throw new Error(`${findingLabel(f.number)} was ${f.status}; review the finding that replaced it.`);
    return f;
}

/**
 * Writes only if the finding still has the status read before: the engine's automatic merge of a
 * scanner duplicate can land between the read and the write.
 */
export async function writeIfUnchanged(id: string, read: FindingStatus, data: Prisma.FindingUpdateManyMutationInput) {
    const { count } = await prisma.finding.updateMany({ where: { id, status: read }, data });
    if (count) return;
    await reviewable(id);
    throw new Error("The finding changed meanwhile; reload the page and review it again.");
}

/** A rejection's or an exclusion's reason goes with it: it would otherwise stand under an accepted finding. */
export async function accept(id: string) {
    const f = await reviewable(id);
    await writeIfUnchanged(id, f.status, { status: "accepted", statusReason: null });
}

async function withReason(id: string, status: "rejected" | "excluded", reason: string) {
    if (!reason.trim()) throw new Error("Give a reason; it is kept as eval data and for the record.");
    const f = await reviewable(id);
    await writeIfUnchanged(id, f.status, { status, statusReason: reason.trim() });
}

/** Andrii's call on what a re-audit found: a fix he verified, or a finding still open (design § 9). */
export async function confirmRecheck(id: string, status: "fixed" | "open") {
    const f = await prisma.finding.findUniqueOrThrow({ where: { id } });
    if (!f.recheck) throw new Error(`${findingLabel(f.number)} has not been re-checked by a later run.`);
    // A later re-audit calls it regressed only if its code was gone after the fix and came back.
    const gone = status === "fixed" && (f.recheck === "changed" || (f.recheck === "fixed" && f.recheckGone));
    await prisma.finding.update({ where: { id }, data: { recheck: status, recheckGone: gone } });
}

export const reject = (id: string, reason: string) => withReason(id, "rejected", reason);
export const exclude = (id: string, reason: string) => withReason(id, "excluded", reason);

const REQUIRED = ["title", "summary", "explanation", "recommendation"] as const;

export async function edit(id: string, fields: EditableFields) {
    for (const k of REQUIRED) if (k in fields && !fields[k]?.trim()) throw new Error(`The ${k} cannot be empty.`);
    const f = await reviewable(id);
    if (f.kind === "question" && fields.severity) throw new Error("A question carries no severity.");
    // A rejected or excluded finding stays out of the report when its text or note changes.
    const status = f.status === "rejected" || f.status === "excluded" ? f.status : "edited";
    const { effortHours: h, ...rest } = fields;
    const error = h && hoursError(h);
    if (error) throw new Error(error);
    const hours =
        h === undefined
            ? {}
            : h
              ? { effort: sizeOf(h), effortHoursLow: h.low, effortHoursHigh: h.high }
              : { effortHoursLow: null, effortHoursHigh: null };
    await writeIfUnchanged(id, f.status, { ...rest, ...hours, status });
}

/** The engine's fold met a finding Andrii reviewed after the fold read it: the fold leaves both alone. */
export class ReviewedMeanwhileError extends Error {}

/** `onlyUnreviewed`: the engine's automatic fold, which must not touch a finding Andrii has reviewed meanwhile. */
export async function merge(sourceId: string, targetLabel: string, o: { onlyUnreviewed?: boolean } = {}) {
    const source = await prisma.finding.findUniqueOrThrow({ where: { id: sourceId } });
    const number = Number(targetLabel.replace(/^F-/i, ""));
    const target = await prisma.finding.findUnique({ where: { projectId_number: { projectId: source.projectId, number } } });
    if (!target) throw new Error(`No finding ${targetLabel} in this project.`);
    if (target.id === source.id) throw new Error("A finding cannot be merged into itself.");
    if (o.onlyUnreviewed && (source.status !== "unreviewed" || target.status !== "unreviewed"))
        throw new ReviewedMeanwhileError(`${findingLabel(source.number)} or ${targetLabel} was reviewed meanwhile.`);
    if (target.status === "merged") throw new Error(`${targetLabel} was itself merged; merge into the finding it went to.`);
    if (target.status === "rejected" || target.status === "excluded" || target.status === "superseded")
        throw new Error(`${targetLabel} is ${target.status}; merge into a finding that stays in the review.`);
    if (source.kind === "finding" && target.kind === "question")
        throw new Error(`${targetLabel} is a question; merge a finding into a finding, so its severity stays in the report.`);
    // A seams finding's paths start with their repository's name; a repository's own paths do not.
    if (!source.repositoryId && target.repositoryId)
        throw new Error(
            `${findingLabel(source.number)} cites every repository by name; merge ${findingLabel(target.number)} into it instead.`
        );
    const prefix =
        source.repositoryId && !target.repositoryId
            ? `${pathNames(await prisma.repository.findMany({ where: { projectId: source.projectId }, orderBy: { createdAt: "asc" } })).get(source.repositoryId)}/`
            : "";
    await prisma.$transaction(async tx => {
        // Conditional, so a second press (or a stale page) cannot add the evidence twice.
        const { count } = await tx.finding.updateMany({
            where: { id: source.id, status: o.onlyUnreviewed ? "unreviewed" : { notIn: ["merged", "superseded"] } },
            data: { status: "merged", mergedIntoId: target.id }
        });
        if (!count) {
            if (o.onlyUnreviewed) throw new ReviewedMeanwhileError(`${findingLabel(source.number)} was reviewed meanwhile.`);
            throw new Error(`${findingLabel(source.number)} was already merged or superseded.`);
        }
        const fresh = await tx.finding.findUniqueOrThrow({ where: { id: target.id } });
        const kept = fresh.evidence as unknown as Evidence[];
        // A range the target already shows would print the same code twice in the report.
        const added = (source.evidence as unknown as Evidence[])
            .map(e => ({ ...e, file: `${prefix}${e.file}` }))
            .filter(e => !kept.some(k => k.file === e.file && k.startLine <= e.startLine && e.endLine <= k.endLine));
        // The fold's write holds only while the target is unreviewed, so it never changes what Andrii reviewed.
        const written = await tx.finding.updateMany({
            where: { id: target.id, ...(o.onlyUnreviewed ? { status: "unreviewed" as const } : {}) },
            data: { evidence: [...kept, ...added] as object[] }
        });
        if (!written.count) throw new ReviewedMeanwhileError(`${targetLabel} was reviewed meanwhile.`);
    });
}

export async function listFindings(projectId: string, o: { status?: string; q?: string; aspect?: string; recheck?: string } = {}) {
    const ids = o.q
        ? (
              await prisma.$queryRaw<{ id: string }[]>`
              SELECT id FROM "Finding" WHERE "projectId" = ${projectId} AND search @@ websearch_to_tsquery('english', ${o.q})`
          ).map(r => r.id)
        : null;
    const rows = await prisma.finding.findMany({
        where: {
            projectId,
            ...(ids && { id: { in: ids } }),
            ...(ASPECTS.some(a => a.key === o.aspect) && { aspect: o.aspect }),
            ...(Object.values<string>(RecheckStatus).includes(o.recheck ?? "") && { recheck: o.recheck as RecheckStatus }),
            status: isStatus(o.status) ? o.status : { notIn: ["merged", "superseded"] }
        }
    });
    return rows.map(r => ({ ...r, label: findingLabel(r.number), severity: r.severity as SeverityName | null })).sort(compareFindings);
}

function isStatus(s: string | undefined): s is FindingStatus {
    return !!s && Object.values<string>(FindingStatus).includes(s);
}

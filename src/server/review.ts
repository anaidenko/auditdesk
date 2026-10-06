import "server-only";

import { compareFindings, findingLabel } from "@/engine/findings";
import type { Evidence, SeverityName } from "@/engine/types";
import { prisma } from "@/server/db";

export const REPORTABLE = ["accepted", "edited"] as const;

export interface EditableFields {
    title?: string;
    severity?: SeverityName | null;
    likelihood?: string | null;
    impact?: string | null;
    summary?: string;
    explanation?: string;
    recommendation?: string;
    effort?: "S" | "M" | "L" | null;
    effortHours?: number | null;
    note?: string | null;
}

export async function accept(id: string) {
    await prisma.finding.update({ where: { id }, data: { status: "accepted" } });
}

async function withReason(id: string, status: "rejected" | "excluded", reason: string) {
    if (!reason.trim()) throw new Error("Give a reason; it is kept as eval data and for the record.");
    await prisma.finding.update({ where: { id }, data: { status, statusReason: reason.trim() } });
}

export const reject = (id: string, reason: string) => withReason(id, "rejected", reason);
export const exclude = (id: string, reason: string) => withReason(id, "excluded", reason);

export async function edit(id: string, fields: EditableFields) {
    const f = await prisma.finding.findUniqueOrThrow({ where: { id } });
    if (f.kind === "question" && fields.severity) throw new Error("A question carries no severity.");
    await prisma.finding.update({ where: { id }, data: { ...fields, status: "edited" } });
}

export async function merge(sourceId: string, targetLabel: string) {
    const source = await prisma.finding.findUniqueOrThrow({ where: { id: sourceId } });
    const number = Number(targetLabel.replace(/^F-/i, ""));
    const target = await prisma.finding.findUnique({ where: { projectId_number: { projectId: source.projectId, number } } });
    if (!target) throw new Error(`No finding ${targetLabel} in this project.`);
    if (target.id === source.id) throw new Error("A finding cannot be merged into itself.");
    if (target.status === "merged") throw new Error(`${targetLabel} was itself merged; merge into the finding it went to.`);
    await prisma.$transaction([
        prisma.finding.update({
            where: { id: target.id },
            data: { evidence: [...(target.evidence as unknown as Evidence[]), ...(source.evidence as unknown as Evidence[])] as object[] }
        }),
        prisma.finding.update({ where: { id: source.id }, data: { status: "merged", mergedIntoId: target.id } })
    ]);
}

export async function listFindings(projectId: string, o: { status?: string; q?: string } = {}) {
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
            status: o.status ? (o.status as never) : { notIn: ["merged", "superseded"] }
        }
    });
    return rows.map(r => ({ ...r, label: findingLabel(r.number), severity: r.severity as SeverityName | null })).sort(compareFindings);
}

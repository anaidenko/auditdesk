import "server-only";

import { findingLabel } from "@/engine/findings";
import type { NewFinding } from "@/engine/types";
import { prisma } from "@/server/db";

/** Takes the project's next number under its row lock, so numbers are unique and never reused. */
export async function createFinding(projectId: string, runId: string | null, f: NewFinding) {
    return prisma.$transaction(async tx => {
        const [{ number }] = await tx.$queryRaw<{ number: number }[]>`
            UPDATE "Project" SET "nextFindingNumber" = "nextFindingNumber" + 1
            WHERE id = ${projectId}
            RETURNING "nextFindingNumber" - 1 AS number`;
        const row = await tx.finding.create({
            data: {
                projectId,
                runId,
                number,
                repositoryId: f.repositoryId,
                agentRunId: f.agentRunId,
                aspect: f.aspect,
                kind: f.kind,
                checklistItem: f.checklistItem,
                title: f.title,
                severity: f.severity,
                likelihood: f.likelihood,
                impact: f.impact,
                summary: f.summary,
                explanation: f.explanation,
                recommendation: f.recommendation,
                effort: f.effort,
                evidence: f.evidence as object[],
                references: f.references as object,
                tags: f.tags,
                source: f.source,
                fingerprint: f.fingerprint
            }
        });
        return { id: row.id, number, label: findingLabel(number) };
    });
}

import { basename } from "node:path";
import "server-only";

import { loadChecklist } from "@/engine/checklists";
import { findingLabel } from "@/engine/findings";
import type { ReportData, ReportFinding } from "@/engine/report/types";
import type { ToolVersions } from "@/engine/scanners/types";
import type { Evidence, References, SeverityName } from "@/engine/types";
import { parseSource } from "@/engine/workspace";
import { prisma } from "@/server/db";
import { REPORTABLE } from "@/server/review";

/** A local path is shown by its last segment: a report must not carry the auditor's home path. */
function repoName(source: string): string {
    const s = parseSource(source);
    return s.kind === "path"
        ? basename(s.path)
        : s.url
              .replace(/\.git$/, "")
              .split(/[/:]/)
              .slice(-2)
              .join("/");
}

export async function loadReportData(projectId: string): Promise<ReportData> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { repositories: true, runs: { orderBy: { createdAt: "desc" }, take: 1, include: { agents: true } } }
    });
    const names = new Map(project.repositories.map(r => [r.id, repoName(r.source)]));
    const rows = await prisma.finding.findMany({ where: { projectId, status: { in: [...REPORTABLE] } } });
    const toReport = (r: (typeof rows)[number]): ReportFinding => ({
        label: findingLabel(r.number),
        severity: r.severity as SeverityName | null,
        aspect: r.aspect,
        checklistItem: r.checklistItem,
        title: r.title,
        likelihood: r.likelihood,
        impact: r.impact,
        summary: r.summary,
        explanation: r.explanation,
        recommendation: r.recommendation,
        effort: r.effort,
        effortHours: r.effortHours,
        evidence: r.evidence as unknown as Evidence[],
        references: r.references as References,
        repository: names.get(r.repositoryId ?? "") ?? "—"
    });
    const latest = project.runs[0];
    const aspects = await Promise.all(
        (latest?.agents ?? []).map(async a => {
            const checklist = await loadChecklist(a.aspect);
            const titles = new Map(checklist.items.map(i => [i.id, i.title]));
            const coverage = ((a.coverage as { item: string; status: string }[] | null) ?? []).map(c => ({
                ...c,
                title: titles.get(c.item) ?? ""
            }));
            return { title: `${checklist.title} (${names.get(a.repositoryId)})`, status: a.status, note: a.note, coverage };
        })
    );
    const served = await prisma.apiCall.findMany({
        where: { run: { projectId } },
        distinct: ["servedModel"],
        select: { servedModel: true }
    });
    const calls = await prisma.apiCall.findMany({ where: { run: { projectId } }, select: { costUsd: true } });
    return {
        projectName: project.name,
        generatedAt: new Date().toISOString().slice(0, 10),
        auditor: process.env.AUDITOR_NAME || "Andrii Naidenko",
        repositories: project.repositories.map(r => ({ name: names.get(r.id)!, branch: r.branch, sha: r.commitSha ?? "not cloned" })),
        aspects,
        servedModels: served.map(s => s.servedModel),
        toolVersions: (latest?.toolVersions as ToolVersions | null) ?? null,
        findings: rows.filter(r => r.kind === "finding").map(toReport),
        questions: rows.filter(r => r.kind === "question").map(toReport),
        costUsd: calls.some(c => c.costUsd === null) ? null : calls.reduce((s, c) => s + Number(c.costUsd), 0)
    };
}

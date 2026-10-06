import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import "server-only";

import { ASPECTS, aspectTitle } from "@/engine/aspects";
import { loadChecklist } from "@/engine/checklists";
import { workspaceDir } from "@/engine/config";
import { findingLabel } from "@/engine/findings";
import type { ReportData, ReportFinding } from "@/engine/report/types";
import type { ToolVersions } from "@/engine/scanners/types";
import type { Evidence, References, SeverityName } from "@/engine/types";
import { parseSource } from "@/engine/workspace";
import { Prisma } from "@/generated/prisma/client";
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
        include: { repositories: { orderBy: { createdAt: "asc" } } }
    });
    const names = new Map(project.repositories.map(r => [r.id, repoName(r.source)]));
    const rows = await prisma.finding.findMany({ where: { projectId, status: { in: [...REPORTABLE] } }, orderBy: { number: "asc" } });
    const toReport = (r: (typeof rows)[number]): ReportFinding => ({
        label: findingLabel(r.number),
        severity: r.severity as SeverityName | null,
        aspect: aspectTitle(r.aspect),
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
    // Per repository and aspect, the latest agent that finished, across runs: a re-run adds a second
    // agent to its run, and a run that failed before its agents started has none.
    const finished = await prisma.agentRun.findMany({
        where: { run: { projectId }, status: { notIn: ["pending", "running"] } },
        orderBy: { createdAt: "desc" }
    });
    const order = (a: { repositoryId: string; aspect: string }) => [
        project.repositories.findIndex(r => r.id === a.repositoryId),
        ASPECTS.findIndex(x => x.key === a.aspect) + 1 || ASPECTS.length + 1
    ];
    const latestAgents = [...new Map(finished.map(a => [`${a.repositoryId}:${a.aspect}`, a] as const).reverse()).values()].sort((x, y) => {
        const [rx, ax] = order(x);
        const [ry, ay] = order(y);
        return rx - ry || ax - ay;
    });
    const scanned = await prisma.run.findFirst({
        where: { projectId, toolVersions: { not: Prisma.DbNull } },
        orderBy: { createdAt: "desc" },
        select: { toolVersions: true }
    });
    const aspects = await Promise.all(
        latestAgents.map(async a => {
            // An aspect dropped from the catalogue keeps its scope row, titled by its key.
            const checklist = await loadChecklist(a.aspect).catch(() => ({
                title: aspectTitle(a.aspect),
                items: [] as { id: string; title: string }[]
            }));
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
    const accesses = await prisma.run.findMany({
        where: { projectId, calls: { some: {} } },
        distinct: ["modelAccess"],
        select: { modelAccess: true }
    });
    return {
        projectName: project.name,
        generatedAt: new Date().toISOString().slice(0, 10),
        auditor: process.env.AUDITOR_NAME || "Andrii Naidenko",
        repositories: project.repositories.map(r => ({ name: names.get(r.id)!, branch: r.branch, sha: r.commitSha ?? "not cloned" })),
        aspects,
        servedModels: served.map(s => s.servedModel),
        modelAccess: accesses.map(a => a.modelAccess),
        toolVersions: (scanned?.toolVersions as ToolVersions | null) ?? null,
        findings: rows.filter(r => r.kind === "finding").map(toReport),
        questions: rows.filter(r => r.kind === "question").map(toReport),
        costUsd: calls.some(c => c.costUsd === null) ? null : calls.reduce((s, c) => s + Number(c.costUsd), 0)
    };
}

export function reportFileName(d: ReportData, ext: "html" | "pdf"): string {
    const slug = d.projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return `auditdesk-${slug}-${d.generatedAt}.${ext}`;
}

/** Each download keeps a copy beside the project's clones (design § 5). */
export async function keepReportCopy(projectId: string, name: string, content: string | Buffer): Promise<void> {
    const dir = join(workspaceDir(), projectId, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), content);
}

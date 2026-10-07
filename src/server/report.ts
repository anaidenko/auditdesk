import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import "server-only";

import { ASPECTS, aspectTitle } from "@/engine/aspects";
import { loadChecklist } from "@/engine/checklists";
import { workspaceDir } from "@/engine/config";
import { findingLabel } from "@/engine/findings";
import { loadReferences, referencesFor } from "@/engine/references";
import type { ReportData, ReportFinding } from "@/engine/report/types";
import type { ToolVersions } from "@/engine/scanners/types";
import type { StackProfile } from "@/engine/stack";
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

/** Names are unique in a report: two repositories of one name are told apart by branch, then by number. */
function reportNames(repositories: { id: string; source: string; branch: string }[]): Map<string, string> {
    const names = new Map<string, string>();
    for (const r of repositories) {
        const base = repoName(r.source);
        const clash = repositories.filter(x => repoName(x.source) === base).length > 1;
        let name = clash ? `${base} (${r.branch})` : base;
        for (let i = 2; [...names.values()].includes(name); i++) name = `${base} (${r.branch}, ${i})`;
        names.set(r.id, name);
    }
    return names;
}

/** The project's repositories as the report names them, for a download per repository. */
export async function reportRepositoryNames(projectId: string): Promise<string[]> {
    const repositories = await prisma.repository.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
    return [...reportNames(repositories).values()];
}

/**
 * The latest re-audit against the findings reported before it (design § 9): what it fixed, left
 * open, found back or changed, and how many reported findings its own run filed. Null until one ran.
 */
async function sinceLastAudit<
    R extends { recheck: string | null; recheckRunId: string | null; recheckedAt: Date | null; runId: string | null }
>(rows: R[], names: Map<string, string>, toReport: (r: R) => ReportFinding): Promise<ReportData["since"]> {
    const rechecked = rows.filter(r => r.recheck && r.recheckRunId);
    if (!rechecked.length) return null;
    const latest = rechecked.reduce((a, b) => (b.recheckedAt! > a.recheckedAt! ? b : a)).recheckRunId!;
    const run = await prisma.run.findUnique({ where: { id: latest }, select: { commits: true } });
    const count = (status: string) => rechecked.filter(r => r.recheck === status).length;
    return {
        commits: Object.entries((run?.commits as Record<string, string> | null) ?? {}).map(([id, sha]) => ({
            repository: names.get(id) ?? "—",
            sha
        })),
        fixed: rechecked.filter(r => r.recheck === "fixed").map(toReport),
        open: count("open"),
        regressed: count("regressed"),
        changed: count("changed"),
        added: rows.filter(r => r.runId === latest).length
    };
}

/** `includeCost`: Andrii ticked the cost at export (design § 8); otherwise the report states none. */
export async function loadReportData(projectId: string, o: { includeCost?: boolean } = {}): Promise<ReportData> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { repositories: { orderBy: { createdAt: "asc" } } }
    });
    const referenceData = loadReferences();
    const names = reportNames(project.repositories);
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
        repository: names.get(r.repositoryId ?? "") ?? "—",
        tags: r.tags,
        fixBeforeSignoff: r.fixBeforeSignoff,
        refs: referencesFor(referenceData, r.checklistItem, r.references as References, { question: r.kind === "question" }),
        recheck: r.recheck
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
    const catalogue = await Promise.all(
        ASPECTS.map(a => loadChecklist(a.key).catch(() => ({ items: [] as { id: string; title: string }[] })))
    );
    const itemTitles = Object.fromEntries(catalogue.flatMap(c => c.items.map(i => [i.id, i.title] as const)));
    const served = await prisma.apiCall.findMany({
        where: { run: { projectId } },
        distinct: ["servedModel"],
        select: { servedModel: true }
    });
    const calls = await prisma.apiCall.findMany({
        where: { run: { projectId } },
        select: { costUsd: true, run: { select: { modelAccess: true } } }
    });
    const accesses = await prisma.run.findMany({
        where: { projectId, calls: { some: {} } },
        distinct: ["modelAccess"],
        select: { modelAccess: true }
    });
    return {
        projectName: project.name,
        generatedAt: new Date().toISOString().slice(0, 10),
        auditor: process.env.AUDITOR_NAME?.trim() || null,
        repositories: project.repositories.map(r => ({
            name: names.get(r.id)!,
            branch: r.branch,
            sha: r.commitSha ?? "not cloned",
            notCovered: (r.stack as StackProfile | null)?.notCovered ?? []
        })),
        aiBuilt: project.aiBuilt,
        aspects,
        itemTitles,
        servedModels: served.map(s => s.servedModel),
        modelAccess: accesses.map(a => a.modelAccess),
        toolVersions: (scanned?.toolVersions as ToolVersions | null) ?? null,
        findings: rows.filter(r => r.kind === "finding" && r.recheck !== "fixed").map(toReport),
        since: await sinceLastAudit(
            rows.filter(r => r.kind === "finding"),
            names,
            toReport
        ),
        questions: rows.filter(r => r.kind === "question").map(toReport),
        cost: o.includeCost
            ? {
                  apiKeyUsd: calls.filter(c => c.run.modelAccess === "api_key").reduce((sum, c) => sum + Number(c.costUsd ?? 0), 0),
                  planUsd: calls.filter(c => c.run.modelAccess === "claude_plan").reduce((sum, c) => sum + Number(c.costUsd ?? 0), 0),
                  unpriced: calls.filter(c => c.costUsd === null).length
              }
            : null
    };
}

/** `part` says what a download other than the report holds: the issues, or a SARIF's repository. */
export function reportFileName(d: ReportData, ext: "html" | "pdf" | "sarif" | "csv" | "json", part?: string): string {
    const slug = (s: string) =>
        s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
    return `auditdesk-${slug(d.projectName)}${part ? `-${slug(part)}` : ""}-${d.generatedAt}.${ext}`;
}

/** Each download keeps a copy beside the project's clones (design § 5). */
export async function keepReportCopy(projectId: string, name: string, content: string | Buffer): Promise<void> {
    const dir = join(workspaceDir(), projectId, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), content);
}

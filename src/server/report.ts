import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import "server-only";

import { ASPECTS, SEAMS, aspectTitle } from "@/engine/aspects";
import { loadChecklist } from "@/engine/checklists";
import { workspaceDir } from "@/engine/config";
import { findingLabel } from "@/engine/findings";
import { pathNames } from "@/engine/pipeline";
import { loadReferences, referencesFor } from "@/engine/references";
import { repoLinks, webUrl } from "@/engine/report/links";
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

/** What the exports leave out until Andrii reviews it: a merged finding waits on the one it joined. */
export async function awaitingReview(projectId: string): Promise<{ findings: number; questions: number }> {
    const counts = await prisma.finding.groupBy({ by: ["kind"], where: { projectId, status: "unreviewed" }, _count: { _all: true } });
    const of = (kind: string) => counts.find(c => c.kind === kind)?._count._all ?? 0;
    return { findings: of("finding"), questions: of("question") };
}

/**
 * The latest re-audit against the findings reported before it (design § 9): what it fixed, left
 * open, found back or changed, and how many reported findings its own run filed. Null until one ran.
 */
function sinceLastAudit<
    R extends {
        recheck: string | null;
        recheckRunId: string | null;
        recheckedAt: Date | null;
        recheckedSha: string | null;
        runId: string | null;
        repositoryId: string | null;
        number: number;
    }
>(rows: R[], names: Map<string, string>, toReport: (r: R) => ReportFinding): ReportData["since"] {
    const rechecked = rows.filter(r => r.recheck && r.recheckRunId);
    if (!rechecked.length) return null;
    const latest = rechecked.reduce((a, b) => (b.recheckedAt! > a.recheckedAt! ? b : a)).recheckRunId!;
    // Only what the latest re-audit checked: a fix found at an earlier one is no news now.
    const now = rechecked.filter(r => r.recheckRunId === latest);
    const count = (status: string) => now.filter(r => r.recheck === status).length;
    return {
        commits: [...new Map(now.map(r => [r.repositoryId ?? "", r.recheckedSha ?? ""] as const)).entries()].map(([id, sha]) => ({
            repository: names.get(id) ?? (id === "" ? aspectTitle(SEAMS) : "—"),
            sha
        })),
        fixed: now.filter(r => r.recheck === "fixed").map(toReport),
        unchanged: count("unchanged"),
        open: count("open"),
        regressed: count("regressed"),
        changed: now.filter(r => r.recheck === "changed").map(r => findingLabel(r.number)),
        added: rows.filter(r => r.runId === latest).length
    };
}

/**
 * What the review made of the findings filed (design § 10). A finding a re-audit found fixed is left
 * out of the report's findings, so it is counted apart; one folded into a finding nobody reviewed
 * yet is not reviewed either.
 */
async function reviewTally(projectId: string): Promise<NonNullable<ReportData["review"]>> {
    const rows = await prisma.finding.findMany({
        where: { projectId, kind: "finding", status: { not: "superseded" } },
        select: { id: true, status: true, recheck: true, mergedIntoId: true }
    });
    const statusOf = new Map(rows.map(r => [r.id, r.status as string]));
    const missing = rows.flatMap(r => (r.mergedIntoId && !statusOf.has(r.mergedIntoId) ? [r.mergedIntoId] : []));
    if (missing.length)
        for (const t of await prisma.finding.findMany({ where: { id: { in: missing } }, select: { id: true, status: true } }))
            statusOf.set(t.id, t.status);
    const tally = { filed: rows.length, reported: 0, fixed: 0, merged: 0, rejected: 0, excluded: 0, unreviewed: 0 };
    for (const r of rows) {
        if (r.status === "accepted" || r.status === "edited") tally[r.recheck === "fixed" ? "fixed" : "reported"]++;
        else if (r.status === "merged") tally[r.mergedIntoId && statusOf.get(r.mergedIntoId) === "unreviewed" ? "unreviewed" : "merged"]++;
        else if (r.status === "rejected" || r.status === "excluded" || r.status === "unreviewed") tally[r.status]++;
    }
    return tally;
}

/**
 * `includeCost`: Andrii ticked the cost at export (design § 8); otherwise the report states none.
 * `draft`: the findings and questions awaiting review go in too, marked, for a first look before it.
 */
export async function loadReportData(projectId: string, o: { includeCost?: boolean; draft?: boolean } = {}): Promise<ReportData> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { repositories: { orderBy: { createdAt: "asc" } } }
    });
    const referenceData = loadReferences();
    const names = reportNames(project.repositories);
    const statuses = o.draft ? [...REPORTABLE, "unreviewed" as const] : [...REPORTABLE];
    const rows = await prisma.finding.findMany({ where: { projectId, status: { in: statuses } }, orderBy: { number: "asc" } });
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
        repository: names.get(r.repositoryId ?? "") ?? (r.aspect === SEAMS ? aspectTitle(SEAMS) : "—"),
        tags: r.tags,
        fixBeforeSignoff: r.fixBeforeSignoff,
        refs: referencesFor(referenceData, r.checklistItem, r.references as References, { question: r.kind === "question" }),
        recheck: r.recheck,
        ...(r.status === "unreviewed" && { unreviewed: true })
    });
    // Per repository and aspect, the latest agent that finished, across runs: a re-run adds a second
    // agent to its run, and a run that failed before its agents started has none.
    const finished = await prisma.agentRun.findMany({
        where: { run: { projectId }, status: { notIn: ["pending", "running"] } },
        orderBy: { createdAt: "desc" }
    });
    // The seams pass reads every repository: one row, after them all, whichever its agent ran under.
    const order = (a: { repositoryId: string; aspect: string }) => [
        a.aspect === SEAMS ? project.repositories.length : project.repositories.findIndex(r => r.id === a.repositoryId),
        ASPECTS.findIndex(x => x.key === a.aspect) + 1 || ASPECTS.length + 1
    ];
    const target = (a: { repositoryId: string; aspect: string }) => (a.aspect === SEAMS ? SEAMS : `${a.repositoryId}:${a.aspect}`);
    const latestAgents = [...new Map(finished.map(a => [target(a), a] as const).reverse()).values()].sort((x, y) => {
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
            // The seams pass reads every repository; its agent is filed under the first.
            const title = a.aspect === SEAMS ? checklist.title : `${checklist.title} (${names.get(a.repositoryId)})`;
            return { key: a.aspect, title, status: a.status, note: a.note, coverage };
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
        auditorUrl: webUrl(process.env.AUDITOR_URL),
        methodUrl: webUrl(process.env.AUDIT_METHOD_URL),
        repositories: project.repositories.map(r => {
            const links = repoLinks(r.source, r.branch, r.commitSha);
            return {
                name: names.get(r.id)!,
                branch: r.branch,
                sha: r.commitSha ?? "not cloned",
                notCovered: (r.stack as StackProfile | null)?.notCovered ?? [],
                ...(links && { links })
            };
        }),
        review: await reviewTally(projectId),
        // A seams finding's paths start with the pipeline's name for each repository, not the report's.
        ...(rows.some(r => r.aspect === SEAMS) && {
            seamsPaths: [...pathNames(project.repositories)].map(([id, path]) => ({ path, repository: names.get(id)! }))
        }),
        aiBuilt: project.aiBuilt,
        draft: rows.some(r => r.status === "unreviewed"),
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
    return `auditdesk-${slug(d.projectName)}${part ? `-${slug(part)}` : ""}${d.draft ? "-draft" : ""}-${d.generatedAt}.${ext}`;
}

/** Each download keeps a copy beside the project's clones (design § 5). */
export async function keepReportCopy(projectId: string, name: string, content: string | Buffer): Promise<void> {
    const dir = join(workspaceDir(), projectId, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), content);
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportData } from "@/engine/report/types";
import { EMPTY_STACK } from "@/engine/stack";
import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { loadReportData, reportFileName } from "@/server/report";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";

beforeEach(resetDb);

const VERSIONS = {
    images: {
        gitleaks: { image: "g", digest: "g@sha256:1" },
        osv: { image: "o", digest: "o@sha256:2" },
        semgrep: { image: "s", digest: "s@sha256:3" }
    },
    rulesets: [],
    osvQueriedAt: "2026-10-06T00:00:00Z"
};

async function run(projectId: string, status: "done" | "failed", toolVersions: object | null, createdAt: Date) {
    return prisma.run.create({
        data: {
            projectId,
            status,
            model: "m",
            effort: "low",
            aspects: ["security"],
            budgetUsd: 1,
            budgetTokens: 20_000,
            createdAt,
            ...(toolVersions && { toolVersions })
        }
    });
}

async function agent(runId: string, repositoryId: string, status: "done" | "partial", createdAt: Date, aspect = "security") {
    await prisma.agentRun.create({
        data: {
            runId,
            repositoryId,
            aspect,
            status,
            tokenShare: 20_000,
            usdShare: 1,
            createdAt,
            coverage: [{ item: "SEC-04", status: status === "done" ? "examined" : "partly" }]
        }
    });
}

describe("the report's auditor", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("is AUDITOR_NAME, and nobody when it is unset", async () => {
        const { project } = await projectWithRepo();
        vi.stubEnv("AUDITOR_NAME", "Jane Roe");
        expect((await loadReportData(project.id)).auditor).toBe("Jane Roe");
        vi.stubEnv("AUDITOR_NAME", "");
        expect((await loadReportData(project.id)).auditor).toBeNull();
    });
});

describe("the report's scope", () => {
    it("shows each aspect of each repository once, from its latest finished agent", async () => {
        const { project, repo } = await projectWithRepo();
        const r = await run(project.id, "done", VERSIONS, new Date("2026-10-06T10:00:00Z"));
        await agent(r.id, repo.id, "partial", new Date("2026-10-06T10:01:00Z"));
        await agent(r.id, repo.id, "done", new Date("2026-10-06T10:30:00Z"));
        const d = await loadReportData(project.id);
        expect(d.aspects.map(a => a.status)).toEqual(["done"]);
    });

    it("keeps the scope and the scanners of earlier runs when the latest run failed before its agents", async () => {
        const { project, repo } = await projectWithRepo();
        const first = await run(project.id, "done", VERSIONS, new Date("2026-10-06T10:00:00Z"));
        await agent(first.id, repo.id, "done", new Date("2026-10-06T10:05:00Z"));
        await run(project.id, "failed", null, new Date("2026-10-06T11:00:00Z"));
        const d = await loadReportData(project.id);
        expect(d.aspects.map(a => a.status)).toEqual(["done"]);
        expect(d.toolVersions?.osvQueriedAt).toBe("2026-10-06T00:00:00Z");
    });
});

describe("aspects in the report", () => {
    it("lists the aspects in the catalogue's order, whatever order their agents finished in", async () => {
        const { project, repo } = await projectWithRepo("/tmp/app");
        const r = await run(project.id, "done", VERSIONS, new Date("2026-10-06T10:00:00Z"));
        await agent(r.id, repo.id, "done", new Date("2026-10-06T10:01:00Z"));
        await agent(r.id, repo.id, "done", new Date("2026-10-06T10:02:00Z"), "quality");
        await agent(r.id, repo.id, "done", new Date("2026-10-06T10:03:00Z"), "dependencies");
        const d = await loadReportData(project.id);
        expect(d.aspects.map(a => a.title)).toEqual([
            "Security (app)",
            "Dependencies and supply chain (app)",
            "Code quality and tests (app)"
        ]);
    });

    it("names a finding's aspect by its title", async () => {
        const { project, repo } = await projectWithRepo();
        const f = await createFinding(project.id, null, sampleFinding(repo.id, { aspect: "quality", checklistItem: "QUA-02" }));
        await prisma.finding.update({ where: { id: f.id }, data: { status: "accepted" } });
        expect((await loadReportData(project.id)).findings.map(x => x.aspect)).toEqual(["Code quality and tests"]);
    });
});

describe("the seams between repositories", () => {
    it("files a finding across repositories under the seams, and names the pass without a repository", async () => {
        const { project, repo } = await projectWithRepo("/tmp/web");
        await prisma.repository.create({ data: { projectId: project.id, source: "/tmp/api", branch: "main" } });
        const r = await run(project.id, "done", null, new Date("2026-10-07"));
        await agent(r.id, repo.id, "done", new Date("2026-10-07"), "seams");
        const f = await createFinding(project.id, r.id, {
            ...sampleFinding(repo.id, { aspect: "seams", checklistItem: "SEA-01" }),
            repositoryId: null
        });
        await prisma.finding.update({ where: { id: f.id }, data: { status: "accepted" } });
        const d = await loadReportData(project.id);
        expect(d.findings.map(x => [x.repository, x.aspect])).toEqual([["Seams between repositories", "Seams between repositories"]]);
        expect(d.aspects.map(a => a.title)).toEqual(["Seams between repositories"]);
    });
});

describe("aspects and repositories that changed", () => {
    it("keeps an aspect no longer in the catalogue in the scope, instead of failing the report", async () => {
        const { project, repo } = await projectWithRepo("/tmp/app");
        const r = await run(project.id, "done", VERSIONS, new Date("2026-10-06T10:00:00Z"));
        await agent(r.id, repo.id, "done", new Date("2026-10-06T10:01:00Z"), "legacy");
        const d = await loadReportData(project.id);
        expect(d.aspects.map(a => a.title)).toEqual(["legacy (app)"]);
    });

    it("lists repositories in the order they were added, whatever was updated since", async () => {
        const { project, repo } = await projectWithRepo("/tmp/web");
        await prisma.repository.create({
            data: { projectId: project.id, source: "/tmp/api", branch: "main", createdAt: new Date(Date.now() + 1000) }
        });
        await prisma.repository.update({ where: { id: repo.id }, data: { commitSha: "a".repeat(40) } });
        expect((await loadReportData(project.id)).repositories.map(r => r.name)).toEqual(["web", "api"]);
    });
});

describe("repositories in the report", () => {
    it("tells apart two repositories of one name by their branch, and carries what each did not cover", async () => {
        const { project, repo } = await projectWithRepo("git@github.com:acme/app.git");
        await prisma.repository.update({
            where: { id: repo.id },
            data: { stack: { ...EMPTY_STACK, notCovered: ["Python (3 files; requirements.txt)"] } }
        });
        await prisma.repository.create({
            data: {
                projectId: project.id,
                source: "git@github.com:acme/app.git",
                branch: "develop",
                createdAt: new Date(Date.now() + 1000)
            }
        });
        await prisma.project.update({ where: { id: project.id }, data: { aiBuilt: true } });
        const d = await loadReportData(project.id);
        expect(d.repositories.map(r => r.name)).toEqual(["acme/app (main)", "acme/app (develop)"]);
        expect(d.repositories.map(r => r.notCovered)).toEqual([["Python (3 files; requirements.txt)"], []]);
        expect(d.aiBuilt).toBe(true);
    });
});

describe("references in the report", () => {
    it("resolves each finding's references from its item, its own CWE first", async () => {
        const { project, repo } = await projectWithRepo();
        const f = await createFinding(
            project.id,
            null,
            sampleFinding(repo.id, { checklistItem: "SEC-03", references: { cwe: "CWE-918" } })
        );
        await prisma.finding.update({ where: { id: f.id }, data: { status: "accepted" } });
        const [finding] = (await loadReportData(project.id)).findings;
        expect(finding.refs?.cwe?.label).toBe("CWE-918");
        expect(finding.refs?.top10?.label).toBe("A01:2025 Broken Access Control");
        expect(finding.refs?.cheatsheets.map(c => c.label)).toContain("Authorization Cheat Sheet");
        expect(finding.fixBeforeSignoff).toBeNull();
        const q = await createFinding(
            project.id,
            null,
            sampleFinding(repo.id, { kind: "question", severity: null, checklistItem: "SEC-10" })
        );
        await prisma.finding.update({ where: { id: q.id }, data: { status: "accepted" } });
        const [question] = (await loadReportData(project.id)).questions;
        expect(question.refs?.top10).toBeNull();
        expect(question.refs?.cheatsheets.map(c => c.label)).toEqual(["Secrets Management Cheat Sheet"]);
    });
});

describe("the cost in the report", () => {
    it("carries the cost only when the export asks for it", async () => {
        const { project } = await projectWithRepo();
        expect((await loadReportData(project.id)).cost).toBeNull();
        expect((await loadReportData(project.id, { includeCost: true })).cost).toEqual({ apiKeyUsd: 0, planUsd: 0, unpriced: 0 });
    });
});

describe("the report's file name", () => {
    it("joins the project's name and the date with one hyphen, whatever the name ends with", () => {
        const d = { projectName: "naidenko.dev (own site)", generatedAt: "2026-10-06" } as ReportData;
        expect(reportFileName(d, "pdf")).toBe("auditdesk-naidenko-dev-own-site-2026-10-06.pdf");
    });
});

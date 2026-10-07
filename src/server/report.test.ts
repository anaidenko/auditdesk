import { beforeEach, describe, expect, it } from "vitest";

import type { ReportData } from "@/engine/report/types";
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

describe("the report's file name", () => {
    it("joins the project's name and the date with one hyphen, whatever the name ends with", () => {
        const d = { projectName: "naidenko.dev (own site)", generatedAt: "2026-10-06" } as ReportData;
        expect(reportFileName(d, "pdf")).toBe("auditdesk-naidenko-dev-own-site-2026-10-06.pdf");
    });
});

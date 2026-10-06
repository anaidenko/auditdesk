import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { loadReportData } from "@/server/report";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

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

async function agent(runId: string, repositoryId: string, status: "done" | "partial", createdAt: Date) {
    await prisma.agentRun.create({
        data: {
            runId,
            repositoryId,
            aspect: "security",
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

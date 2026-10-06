import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { resetDb } from "@/test/db";

beforeEach(resetDb);

async function project() {
    return prisma.project.create({ data: { name: "Acme" } });
}

function run(projectId: string) {
    return { projectId, model: "claude-opus-5-5", effort: "medium", aspects: ["security"], budgetUsd: 10, budgetTokens: 400000 };
}

describe("schema", () => {
    it("refuses a second active run in one project", async () => {
        const p = await project();
        await prisma.run.create({ data: run(p.id) });
        await expect(prisma.run.create({ data: run(p.id) })).rejects.toThrow(/Unique constraint/);
    });

    it("allows a new run once the previous one has finished", async () => {
        const p = await project();
        const first = await prisma.run.create({ data: run(p.id) });
        await prisma.run.update({ where: { id: first.id }, data: { status: "done" } });
        await expect(prisma.run.create({ data: run(p.id) })).resolves.toBeTruthy();
    });

    it("keeps findings searchable by their words", async () => {
        const p = await project();
        await prisma.finding.create({
            data: {
                projectId: p.id,
                number: 1,
                aspect: "security",
                kind: "finding",
                title: "SQL injection in the login route",
                summary: "User input reaches a raw query.",
                explanation: "…",
                recommendation: "Use a parameterised query.",
                evidence: [{ file: "routes/login.ts", startLine: 10, endLine: 12 }],
                source: "agent",
                fingerprint: "f1"
            }
        });
        const hits = await prisma.$queryRaw<{ number: number }[]>`
            SELECT number FROM "Finding" WHERE search @@ websearch_to_tsquery('english', 'injection login')`;
        expect(hits.map(h => h.number)).toEqual([1]);
    });

    it("has no drift between the migrations and the schema", () => {
        const out = execFileSync(
            "pnpm",
            // The test database holds exactly the migrations (global setup deploys them), so no shadow database is needed.
            ["-s", "prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"],
            { encoding: "utf8" }
        );
        const statements = out.split("\n").filter(l => /^(CREATE|ALTER|DROP)/.test(l));
        expect(statements).toEqual([]);
    });
});

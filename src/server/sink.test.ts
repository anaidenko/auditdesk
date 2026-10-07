import { beforeEach, describe, expect, it } from "vitest";

import { EMPTY_STACK } from "@/engine/stack";
import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { reject } from "@/server/review";
import { PrismaSink } from "@/server/sink";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";

beforeEach(resetDb);

async function setup() {
    const { project, repo } = await projectWithRepo();
    const run = await prisma.run.create({
        data: { projectId: project.id, model: "m", effort: "low", aspects: ["security"], budgetUsd: 1, budgetTokens: 20_000 }
    });
    const add = (over: Parameters<typeof sampleFinding>[1]) => createFinding(project.id, run.id, sampleFinding(repo.id, over));
    return { sink: new PrismaSink(run.id, project.id), repo, add, run };
}

describe("PrismaSink", () => {
    it("supersedes only the unreviewed agent findings of the re-run aspect", async () => {
        const { sink, repo, add } = await setup();
        const agentNew = await add({ source: "agent", title: "new" });
        const agentAccepted = await add({ source: "agent", title: "accepted" });
        await prisma.finding.update({ where: { id: agentAccepted.id }, data: { status: "accepted" } });
        const scanner = await add({ source: "scanner", title: "scanner" });
        const otherAspect = await add({ source: "agent", aspect: "dependencies", title: "dependency" });
        await sink.supersedeUnreviewed(repo.id, "security");
        const status = async (id: string) => (await prisma.finding.findUniqueOrThrow({ where: { id } })).status;
        expect(await status(agentNew.id)).toBe("superseded");
        expect(await status(agentAccepted.id)).toBe("accepted");
        expect(await status(scanner.id)).toBe("unreviewed");
        expect(await status(otherAspect.id)).toBe("unreviewed");
    });

    it("supersedes the seams pass's unreviewed findings, which belong to no repository, on its re-run", async () => {
        const { sink, repo, add } = await setup();
        const seam = await add({ source: "agent", aspect: "seams", checklistItem: "SEA-01", title: "seam" });
        const kept = await add({ source: "agent", aspect: "seams", checklistItem: "SEA-02", title: "kept" });
        await prisma.finding.updateMany({ where: { id: { in: [seam.id, kept.id] } }, data: { repositoryId: null } });
        await prisma.finding.update({ where: { id: kept.id }, data: { status: "accepted" } });
        const own = await add({ source: "agent", aspect: "seams", title: "a repository's" });
        const other = await projectWithRepo();
        const elsewhere = await createFinding(other.project.id, null, {
            ...sampleFinding(other.repo.id, { aspect: "seams" }),
            repositoryId: null
        });
        await sink.supersedeUnreviewed(null, "seams");
        expect((await prisma.finding.findUniqueOrThrow({ where: { id: elsewhere.id } })).status).toBe("unreviewed");
        const status = async (id: string) => (await prisma.finding.findUniqueOrThrow({ where: { id } })).status;
        expect([await status(seam.id), await status(kept.id), await status(own.id)]).toEqual(["superseded", "accepted", "unreviewed"]);
        expect(repo.id).toBeTruthy();
    });

    async function foldSetup() {
        const { sink, repo, add, run } = await setup();
        const agentRun = await prisma.agentRun.create({
            data: { runId: run.id, repositoryId: repo.id, aspect: "security", status: "done", tokenShare: 1, usdShare: 1 }
        });
        const line7 = [{ file: "src/server.js", startLine: 7, endLine: 7, snippet: "eval(req.query.expr)" }];
        const agentAt = (over: Parameters<typeof add>[0] = {}) =>
            add({
                source: "agent",
                agentRunId: agentRun.id,
                checklistItem: "SEC-04",
                evidence: [{ file: "src/server.js", startLine: 6, endLine: 8 }],
                ...over
            });
        return { sink, repo, add, run, agentRun, line7, agentAt };
    }
    const row = (id: string) => prisma.finding.findUniqueOrThrow({ where: { id } });

    it("folds a scanner finding that an agent filed again into the agent's, adding no evidence it already shows", async () => {
        const { sink, repo, add, agentRun, line7, agentAt } = await foldSetup();
        const scanner = await add({ source: "scanner", checklistItem: "SEC-04", evidence: line7 });
        const xss = await add({ source: "scanner", checklistItem: "SEC-05", evidence: line7 });
        const agent = await agentAt();
        expect(await sink.foldScannerDuplicates(repo.id, agentRun.id)).toEqual([{ from: scanner.label, into: agent.label }]);
        expect(await row(scanner.id)).toMatchObject({ status: "merged", mergedIntoId: agent.id });
        expect((await row(agent.id)).evidence).toHaveLength(1);
        expect((await row(xss.id)).status).toBe("unreviewed");
    });

    it("keeps the higher severity when it folds, and says so", async () => {
        const { sink, repo, add, agentRun, line7, agentAt } = await foldSetup();
        await add({ source: "scanner", checklistItem: "SEC-04", severity: "critical", evidence: line7 });
        const agent = await agentAt({ severity: "high" });
        expect(await sink.foldScannerDuplicates(repo.id, agentRun.id)).toEqual([
            expect.objectContaining({ into: agent.label, raised: "critical" })
        ]);
        expect((await row(agent.id)).severity).toBe("critical");
    });

    it("folds only unreviewed findings of this run: not a reviewed one, another agent's, or an earlier run's", async () => {
        const { sink, repo, add, agentRun, line7, agentAt, run } = await foldSetup();
        const reviewedScanner = await add({ source: "scanner", checklistItem: "SEC-04", evidence: line7 });
        await prisma.finding.update({ where: { id: reviewedScanner.id }, data: { status: "accepted" } });
        const earlierRun = await prisma.run.create({
            data: {
                projectId: run.projectId,
                status: "done",
                model: "m",
                effort: "low",
                aspects: ["security"],
                budgetUsd: 1,
                budgetTokens: 20_000
            }
        });
        const earlier = await createFinding(
            run.projectId,
            earlierRun.id,
            sampleFinding(repo.id, { source: "scanner", checklistItem: "SEC-04", evidence: line7 })
        );
        const reviewedAgent = await agentAt();
        await prisma.finding.update({ where: { id: reviewedAgent.id }, data: { status: "accepted" } });
        const other = await prisma.agentRun.create({
            data: { runId: run.id, repositoryId: repo.id, aspect: "quality", status: "done", tokenShare: 1, usdShare: 1 }
        });
        await add({ source: "agent", agentRunId: other.id, checklistItem: "SEC-04", evidence: line7 });
        expect(await sink.foldScannerDuplicates(repo.id, agentRun.id)).toEqual([]);
        expect((await row(earlier.id)).status).toBe("unreviewed");
    });

    it("brings a folded scanner finding back to the review when its agent's aspect is re-run", async () => {
        const { sink, repo, add, agentRun, line7, agentAt } = await foldSetup();
        const scanner = await add({ source: "scanner", checklistItem: "SEC-04", evidence: line7, title: "Secret in the code" });
        await agentAt();
        await sink.foldScannerDuplicates(repo.id, agentRun.id);
        await sink.supersedeUnreviewed(repo.id, "security");
        expect(await row(scanner.id)).toMatchObject({ status: "unreviewed", mergedIntoId: null });
        expect(await sink.findingIndex(repo.id)).toContainEqual(expect.stringContaining("Secret in the code"));
    });

    it("lists rejected findings in the agent's index with the reason, and leaves out merged and superseded ones", async () => {
        const { sink, repo, add } = await setup();
        const wrong = await add({ title: "Not reachable" });
        await reject(wrong.id, "Admin-only route.");
        const gone = await add({ title: "Gone" });
        await prisma.finding.update({ where: { id: gone.id }, data: { status: "superseded" } });
        const index = await sink.findingIndex(repo.id);
        expect(index).toHaveLength(1);
        expect(index[0]).toMatch(/Not reachable \(rejected by the auditor: Admin-only route\.; do not report it again\)/);
    });

    it("records a detected stack on the repository and leaves a confirmed profile as Andrii wrote it", async () => {
        const { project, repo } = await projectWithRepo();
        await prisma.repository.update({ where: { id: repo.id }, data: { stackText: "Mine.", stackConfirmedAt: new Date() } });
        const run = await prisma.run.create({
            data: { projectId: project.id, model: "m", effort: "low", aspects: ["security"], budgetUsd: 1, budgetTokens: 20_000 }
        });
        const profile = { ...EMPTY_STACK, frameworks: ["Express 4"] };
        await new PrismaSink(run.id, project.id).stackDetected(repo.id, profile);
        const after = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
        expect(after.stack).toEqual(profile);
        expect(after.stackDetectedAt).toBeInstanceOf(Date);
        expect(after.stackText).toBe("Mine.");
    });
});

import { beforeEach, describe, expect, it } from "vitest";

import type { RecheckResult } from "@/engine/recheck";
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
    it("gives a re-audit the repository's reported findings from runs at another commit, and stores what it found", async () => {
        const { project, repo } = await projectWithRepo();
        const runAt = (sha: string | null) =>
            prisma.run.create({
                data: {
                    projectId: project.id,
                    model: "m",
                    effort: "low",
                    aspects: ["security"],
                    budgetUsd: 1,
                    budgetTokens: 20_000,
                    status: "done",
                    ...(sha ? { commits: { [repo.id]: sha } } : {})
                }
            });
        const before = await runAt("a".repeat(40));
        const same = await runAt("b".repeat(40));
        const now = await prisma.run.create({
            data: { projectId: project.id, model: "m", effort: "low", aspects: ["security"], budgetUsd: 1, budgetTokens: 20_000 }
        });
        const add = async (runId: string, status: "accepted" | "edited" | "unreviewed" | "rejected", over = {}) => {
            const f = await createFinding(project.id, runId, sampleFinding(repo.id, over));
            await prisma.finding.update({ where: { id: f.id }, data: { status } });
            return f;
        };
        const accepted = await add(before.id, "accepted", { fingerprint: "fp-a" });
        const edited = await add(before.id, "edited", { source: "scanner" });
        await add(before.id, "unreviewed");
        await add(before.id, "rejected");
        await add(before.id, "accepted", { kind: "question", severity: null });
        const atSame = await add(same.id, "accepted");
        const filed = await add(now.id, "unreviewed", { fingerprint: "fp-now" });
        const orphan = await add(before.id, "accepted");
        await prisma.finding.update({ where: { id: orphan.id }, data: { runId: null } });
        const sink = new PrismaSink(now.id, project.id);

        const earlier = await sink.earlierFindings(repo.id, "b".repeat(40));
        expect(earlier.map(f => f.label).sort()).toEqual([accepted.label, edited.label, orphan.label].sort());
        expect(earlier.find(f => f.id === edited.id)).toMatchObject({
            source: "scanner",
            recheck: null,
            recheckGone: false,
            recheckDigest: null
        });
        expect(filed).toBeTruthy();

        const result = (id: string, over: Partial<RecheckResult>): RecheckResult => ({
            id,
            label: "",
            status: "changed",
            digest: "d1",
            gone: false,
            keep: false,
            ...over
        });
        await sink.recheckFindings(
            [
                result(accepted.id, { evidence: [{ file: "a.ts", startLine: 5, endLine: 6, snippet: "x" }] }),
                result(edited.id, { status: "fixed", gone: true })
            ],
            "b".repeat(40)
        );
        expect(await prisma.finding.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({
            recheck: "fixed",
            recheckedSha: "b".repeat(40),
            recheckRunId: now.id,
            recheckGone: true,
            recheckDigest: "d1",
            status: "edited"
        });
        expect((await prisma.finding.findUniqueOrThrow({ where: { id: accepted.id } })).evidence).toEqual([
            { file: "a.ts", startLine: 5, endLine: 6, snippet: "x" }
        ]);
        // Re-checked at this commit already: a second run there has nothing new to say of it.
        expect((await sink.earlierFindings(repo.id, "b".repeat(40))).map(f => f.id)).toEqual([orphan.id]);
        // A finding that stays fixed keeps the commit and the run it was found fixed at.
        const later = new PrismaSink(same.id, project.id);
        await later.recheckFindings([result(edited.id, { status: "fixed", keep: true, digest: "d2" })], "c".repeat(40));
        expect(await prisma.finding.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({
            recheckedSha: "b".repeat(40),
            recheckRunId: now.id,
            recheckDigest: "d2"
        });
        expect(await sink.findingIndex(repo.id)).toContainEqual(
            expect.stringMatching(/\(fixed at bbbbbbb; file it again if it is back\)$/)
        );
        expect(atSame).toBeTruthy();
    });

    it("gives a re-audit the project's seams findings, which belong to no repository, at another set of commits", async () => {
        const { project, repo: web } = await projectWithRepo("/tmp/web");
        const api = await prisma.repository.create({
            data: { projectId: project.id, source: "/tmp/api", branch: "main", createdAt: new Date(Date.now() + 1000) }
        });
        // Written api first: JSONB keeps no key order, so the joined commits follow the repositories' order.
        const runAt = (commits: Record<string, string>) =>
            prisma.run.create({
                data: {
                    projectId: project.id,
                    model: "m",
                    effort: "low",
                    aspects: ["seams"],
                    budgetUsd: 1,
                    budgetTokens: 20_000,
                    status: "done",
                    commits
                }
            });
        const before = await runAt({ [api.id]: "c".repeat(40), [web.id]: "a".repeat(40) });
        const same = await runAt({ [api.id]: "d".repeat(40), [web.id]: "b".repeat(40) });
        const now = await prisma.run.create({
            data: { projectId: project.id, model: "m", effort: "low", aspects: ["seams"], budgetUsd: 1, budgetTokens: 20_000 }
        });
        const seam = async (runId: string, title: string) => {
            const f = await createFinding(project.id, runId, { ...sampleFinding(web.id, { aspect: "seams", title }), repositoryId: null });
            await prisma.finding.update({ where: { id: f.id }, data: { status: "accepted" } });
            return f;
        };
        const earlier = await seam(before.id, "earlier");
        await seam(same.id, "at these commits");
        const other = await projectWithRepo();
        const elsewhere = await createFinding(other.project.id, null, {
            ...sampleFinding(other.repo.id, { aspect: "seams" }),
            repositoryId: null
        });
        await prisma.finding.update({ where: { id: elsewhere.id }, data: { status: "accepted" } });
        const sink = new PrismaSink(now.id, project.id);
        const commit = `${"b".repeat(40)}+${"d".repeat(40)}`;
        expect((await sink.earlierFindings(null, commit)).map(f => f.id)).toEqual([earlier.id]);
        await sink.recheckFindings(
            [{ id: earlier.id, label: "F-001", status: "unchanged", digest: "d", gone: false, keep: false }],
            commit
        );
        expect(await prisma.finding.findUniqueOrThrow({ where: { id: earlier.id } })).toMatchObject({
            recheck: "unchanged",
            recheckedSha: commit
        });
        expect(await sink.earlierFindings(null, commit)).toEqual([]);
    });

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
        const { sink, add } = await setup();
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
    });

    it("indexes the project's seams findings, which belong to no repository, and those that cite a repository's path", async () => {
        const { sink, add } = await setup();
        const seam = await add({
            aspect: "seams",
            checklistItem: "SEA-02",
            title: "A rejected seam",
            evidence: [{ file: "web/src/api.ts", startLine: 3, endLine: 3 }]
        });
        await prisma.finding.update({
            where: { id: seam.id },
            data: { repositoryId: null, status: "rejected", statusReason: "by design" }
        });
        const other = await projectWithRepo();
        await createFinding(other.project.id, null, {
            ...sampleFinding(other.repo.id, { aspect: "seams", title: "Elsewhere" }),
            repositoryId: null
        });
        const index = await sink.findingIndex(null);
        expect(index).toEqual([
            expect.stringMatching(/web\/src\/api\.ts:3 A rejected seam \(rejected by the auditor: by design; do not report it again\)$/)
        ]);
        expect(await sink.findingIndex(null, { cites: "web" })).toEqual(index);
        expect(await sink.findingIndex(null, { cites: "we" })).toEqual([]);
        expect(await sink.findingIndex(null, { cites: "api" })).toEqual([]);
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

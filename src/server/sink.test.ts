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
    return { sink: new PrismaSink(run.id, project.id), repo, add };
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
        expect(after.stackText).toBe("Mine.");
    });
});

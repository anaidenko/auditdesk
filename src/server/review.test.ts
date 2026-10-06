import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { accept, edit, exclude, listFindings, merge, reject } from "@/server/review";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";

beforeEach(resetDb);

async function twoFindings() {
    const { project, repo } = await projectWithRepo();
    const a = await createFinding(project.id, null, sampleFinding(repo.id, { title: "Raw SQL in login", severity: "high" }));
    const b = await createFinding(
        project.id,
        null,
        sampleFinding(repo.id, { title: "Raw SQL in search", severity: "critical", evidence: [{ file: "b.ts", startLine: 3, endLine: 4 }] })
    );
    return { project, a, b };
}

const status = async (id: string) => (await prisma.finding.findUniqueOrThrow({ where: { id } })).status;

describe("review", () => {
    it("accepts a finding", async () => {
        const { a } = await twoFindings();
        await accept(a.id);
        expect(await status(a.id)).toBe("accepted");
    });

    it("needs a reason to reject, and keeps the rejected finding", async () => {
        const { a } = await twoFindings();
        await expect(reject(a.id, " ")).rejects.toThrow(/reason/);
        await reject(a.id, "The input is a constant.");
        expect(await prisma.finding.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
            status: "rejected",
            statusReason: "The input is a constant."
        });
    });

    it("marks an edited finding and changes its severity", async () => {
        const { a } = await twoFindings();
        await edit(a.id, { title: "SQL injection in login", severity: "critical" });
        expect(await prisma.finding.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
            status: "edited",
            severity: "critical",
            title: "SQL injection in login"
        });
    });

    it("refuses a severity on a question", async () => {
        const { project, a: _a } = await twoFindings();
        const repo = await prisma.repository.findFirstOrThrow({ where: { projectId: project.id } });
        const q = await createFinding(project.id, null, sampleFinding(repo.id, { kind: "question", severity: null }));
        await expect(edit(q.id, { severity: "high" })).rejects.toThrow(/question/);
    });

    it("merges a duplicate into another finding, which gains its evidence", async () => {
        const { a, b } = await twoFindings();
        await merge(a.id, "F-002");
        const target = await prisma.finding.findUniqueOrThrow({ where: { id: b.id } });
        expect(await status(a.id)).toBe("merged");
        expect((target.evidence as { file: string }[]).map(e => e.file)).toEqual(["b.ts", "a.ts"]);
    });

    it("refuses to merge a finding into itself", async () => {
        const { a } = await twoFindings();
        await expect(merge(a.id, "F-001")).rejects.toThrow(/itself/);
    });

    it("excludes a valid finding from the report, with a reason", async () => {
        const { a } = await twoFindings();
        await exclude(a.id, "Out of scope for this engagement.");
        expect(await status(a.id)).toBe("excluded");
    });

    it("lists by severity and finds by words", async () => {
        const { project } = await twoFindings();
        expect((await listFindings(project.id)).map(f => f.label)).toEqual(["F-002", "F-001"]);
        expect((await listFindings(project.id, { q: "search" })).map(f => f.label)).toEqual(["F-002"]);
    });
});

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

    it("keeps Andrii's sign-off call, and clears it back to the severity's default", async () => {
        const { a } = await twoFindings();
        await edit(a.id, { fixBeforeSignoff: true });
        expect((await prisma.finding.findUniqueOrThrow({ where: { id: a.id } })).fixBeforeSignoff).toBe(true);
        await edit(a.id, { fixBeforeSignoff: null });
        expect((await prisma.finding.findUniqueOrThrow({ where: { id: a.id } })).fixBeforeSignoff).toBeNull();
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

    it("keeps a rejected or excluded finding out of the report when it is edited", async () => {
        const { a, b } = await twoFindings();
        await reject(a.id, "False positive.");
        await exclude(b.id, "Out of scope.");
        await edit(a.id, { note: "Checked again on 2026-10-06." });
        await edit(b.id, { title: "Raw SQL in search (legacy)" });
        const rows = await prisma.finding.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { number: "asc" } });
        expect(rows.map(r => r.status)).toEqual(["rejected", "excluded"]);
    });

    it("merges without repeating evidence the target already shows", async () => {
        const { project, repo } = await projectWithRepo();
        const add = (evidence: { file: string; startLine: number; endLine: number }[]) =>
            createFinding(project.id, null, sampleFinding(repo.id, { evidence }));
        const target = await add([{ file: "a.ts", startLine: 1, endLine: 9 }]);
        const inside = await add([
            { file: "a.ts", startLine: 3, endLine: 4 },
            { file: "b.ts", startLine: 1, endLine: 1 }
        ]);
        await merge(inside.id, target.label);
        expect((await prisma.finding.findUniqueOrThrow({ where: { id: target.id } })).evidence).toEqual([
            { file: "a.ts", startLine: 1, endLine: 9 },
            { file: "b.ts", startLine: 1, endLine: 1 }
        ]);
    });

    it("refuses to accept or edit a merged or superseded finding", async () => {
        const { a, b } = await twoFindings();
        await merge(a.id, b.label);
        await expect(accept(a.id)).rejects.toThrow(/merged/);
        await expect(edit(a.id, { title: "x" })).rejects.toThrow(/merged/);
        await prisma.finding.update({ where: { id: b.id }, data: { status: "superseded" } });
        await expect(accept(b.id)).rejects.toThrow(/superseded/);
    });

    it("refuses an edit that empties a required field", async () => {
        const { a } = await twoFindings();
        await expect(edit(a.id, { title: "  " })).rejects.toThrow(/title/);
        await expect(edit(a.id, { recommendation: "" })).rejects.toThrow(/recommendation/);
        expect((await prisma.finding.findUniqueOrThrow({ where: { id: a.id } })).title).toBe("Raw SQL in login");
    });

    it("refuses to merge into a finding that left the report", async () => {
        const { a, b } = await twoFindings();
        await reject(b.id, "Not reachable.");
        await expect(merge(a.id, b.label)).rejects.toThrow(/rejected/);
        expect((await prisma.finding.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("unreviewed");
    });

    it("ignores an unknown status filter instead of failing the page", async () => {
        const { project } = await twoFindings();
        expect(await listFindings(project.id, { status: "bogus" })).toHaveLength(2);
    });

    it("merges once when Merge is pressed twice", async () => {
        const { a, b } = await twoFindings();
        await merge(a.id, b.label);
        await expect(merge(a.id, b.label)).rejects.toThrow(/already merged/);
        const target = await prisma.finding.findUniqueOrThrow({ where: { id: b.id } });
        expect(target.evidence as unknown[]).toHaveLength(2);
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

    it("filters by aspect, and ignores an aspect it does not know", async () => {
        const { project, repo } = await projectWithRepo();
        await createFinding(project.id, null, sampleFinding(repo.id, { title: "SQL" }));
        await createFinding(project.id, null, sampleFinding(repo.id, { title: "No tests", aspect: "quality", checklistItem: "QUA-02" }));
        expect((await listFindings(project.id, { aspect: "quality" })).map(f => f.title)).toEqual(["No tests"]);
        expect(await listFindings(project.id, { aspect: "bogus" })).toHaveLength(2);
    });
});

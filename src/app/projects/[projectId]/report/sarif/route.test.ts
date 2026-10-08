import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";

import { GET as issues } from "../issues/route";

import { GET as sarif } from "./route";

beforeEach(resetDb);

async function project() {
    const { project, repo } = await projectWithRepo();
    const run = await prisma.run.create({
        data: { projectId: project.id, model: "m", effort: "low", aspects: ["security"], budgetUsd: 1, budgetTokens: 20_000 }
    });
    const accepted = await createFinding(project.id, run.id, sampleFinding(repo.id, { title: "Raw SQL" }));
    await prisma.finding.update({ where: { id: accepted.id }, data: { status: "accepted" } });
    await createFinding(project.id, run.id, sampleFinding(repo.id, { title: "Not reviewed yet" }));
    return project.id;
}

const get = (route: typeof sarif, id: string, path: string, site = "same-origin") =>
    route(new Request(`http://127.0.0.1/projects/${id}/report/${path}`, { headers: { "sec-fetch-site": site } }), {
        params: Promise.resolve({ projectId: id })
    });

describe("the SARIF and issue exports", () => {
    it("serves the reported findings as SARIF, and leaves out the unreviewed", async () => {
        const res = await get(sarif, await project(), "sarif");
        expect(res.headers.get("content-type")).toBe("application/sarif+json");
        expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="auditdesk-acme-x-\d{4}-\d{2}-\d{2}\.sarif"/);
        const log = await res.json();
        expect(log.runs[0].results.map((r: { message: { text: string } }) => r.message.text)).toEqual([expect.stringMatching(/^Raw SQL/)]);
    });

    it("serves a draft's SARIF with the unreviewed marked, while the issues stay reviewed only", async () => {
        const id = await project();
        const res = await get(sarif, id, "sarif?draft=1");
        expect(res.headers.get("content-disposition")).toMatch(/filename="auditdesk-acme-x-draft-\d{4}-\d{2}-\d{2}\.sarif"/);
        const log = await res.json();
        expect(log.runs[0].results.map((r: { message: { text: string } }) => r.message.text)).toEqual([
            expect.stringMatching(/^Raw SQL/),
            expect.stringMatching(/^Not reviewed yet: Not reviewed yet/)
        ]);
        expect(await (await get(issues, id, "issues?draft=1")).text()).not.toContain("Not reviewed yet");
    });

    it("serves one repository's SARIF at a time when the project has several", async () => {
        const id = await project();
        const api = await prisma.repository.create({ data: { projectId: id, source: "/tmp/api", branch: "main" } });
        const f = await createFinding(id, null, sampleFinding(api.id, { title: "Open redirect" }));
        await prisma.finding.update({ where: { id: f.id }, data: { status: "accepted" } });
        const none = await get(sarif, id, "sarif");
        expect(none.status).toBe(400);
        expect(await none.text()).toBe("Name one repository with ?repository=: x, api.");
        const res = await get(sarif, id, "sarif?repository=api");
        expect(res.headers.get("content-disposition")).toMatch(/filename="auditdesk-acme-api-\d{4}-\d{2}-\d{2}\.sarif"/);
        const log = await res.json();
        expect(log.runs).toHaveLength(1);
        expect(log.runs[0].results.map((r: { message: { text: string } }) => r.message.text)).toEqual([
            expect.stringMatching(/^Open redirect/)
        ]);
        expect((await get(sarif, id, "sarif?repository=web")).status).toBe(400);
    });

    it("serves the reported findings as issue drafts in CSV", async () => {
        const res = await get(issues, await project(), "issues");
        expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(res.headers.get("content-disposition")).toMatch(/filename="auditdesk-acme-issues-\d{4}-\d{2}-\d{2}\.csv"/);
        const csv = await res.text();
        expect(csv).toContain('"F-001: Raw SQL"');
        expect(csv).not.toContain("Not reviewed yet");
    });

    it("serves the same drafts as JSON for pnpm issues:gh", async () => {
        const res = await get(issues, await project(), "issues?format=json");
        expect(res.headers.get("content-type")).toBe("application/json");
        expect((await res.json()).map((d: { title: string }) => d.title)).toEqual(["F-001: Raw SQL"]);
    });

    it("refuses a request another site started", async () => {
        const id = await project();
        expect((await get(sarif, id, "sarif", "cross-site")).status).toBe(403);
        expect((await get(issues, id, "issues", "cross-site")).status).toBe(403);
    });
});

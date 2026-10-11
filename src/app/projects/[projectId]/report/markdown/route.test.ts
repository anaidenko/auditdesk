import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { workspaceDir } from "@/engine/config";
import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";

import { GET } from "./route";

beforeEach(resetDb);

async function project() {
    const { project, repo } = await projectWithRepo();
    const run = await prisma.run.create({
        data: { projectId: project.id, model: "m", effort: "low", aspects: ["security"], budgetUsd: 1, budgetTokens: 20_000 }
    });
    const accepted = await createFinding(project.id, run.id, sampleFinding(repo.id, { title: "Raw SQL" }));
    await prisma.finding.update({ where: { id: accepted.id }, data: { status: "accepted", effortHoursLow: 2, effortHoursHigh: 4 } });
    await createFinding(project.id, run.id, sampleFinding(repo.id, { title: "Not reviewed yet" }));
    return project.id;
}

const get = (id: string, query = "", site = "same-origin") =>
    GET(new Request(`http://127.0.0.1/projects/${id}/report/markdown${query}`, { headers: { "sec-fetch-site": site } }), {
        params: Promise.resolve({ projectId: id })
    });

describe("the Markdown for AI agents", () => {
    it("serves the reported findings as Markdown, leaves out the unreviewed, and keeps a copy beside the clones", async () => {
        const id = await project();
        const res = await get(id);
        expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
        const name = /filename="(auditdesk-acme-ai-\d{4}-\d{2}-\d{2}\.md)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
        expect(name).toBeDefined();
        const md = await res.text();
        expect(md).toMatch(/^# Code audit: Acme\n/);
        expect(md).toContain("### F-001: Raw SQL");
        expect(md).not.toContain("Not reviewed yet");
        expect(md).toContain("**Effort:** S (up to 2 hours)");
        expect(existsSync(join(workspaceDir(), id, "reports", name!))).toBe(true);
    });

    it("adds the hours and a draft's unreviewed, marked, when the download asks for them", async () => {
        const id = await project();
        const res = await get(id, "?draft=1&hours=1");
        expect(res.headers.get("content-disposition")).toMatch(/filename="auditdesk-acme-ai-draft-\d{4}-\d{2}-\d{2}\.md"/);
        const md = await res.text();
        expect(md).toContain("### F-002 (not reviewed): Not reviewed yet");
        expect(md).toContain("**Effort:** S (2–4 h)");
    });

    it("refuses a request another site started", async () => {
        expect((await get(await project(), "", "cross-site")).status).toBe(403);
    });
});

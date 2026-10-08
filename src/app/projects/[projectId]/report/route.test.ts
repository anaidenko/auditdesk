import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";

import { GET } from "./route";

beforeEach(resetDb);
afterEach(() => {
    delete process.env.WORKSPACE_DIR;
});

async function download(site: string, query = "", seed?: (projectId: string, repositoryId: string) => Promise<unknown>) {
    const { project, repo } = await projectWithRepo();
    await seed?.(project.id, repo.id);
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), "ws-"));
    const res = await GET(new Request(`http://127.0.0.1/projects/${project.id}/report${query}`, { headers: { "sec-fetch-site": site } }), {
        params: Promise.resolve({ projectId: project.id })
    });
    return { res, copies: join(process.env.WORKSPACE_DIR, project.id, "reports") };
}

describe("the report download", () => {
    it("serves the auditor's own download and keeps a copy", async () => {
        const { res, copies } = await download("same-origin");
        expect(res.status).toBe(200);
        expect(existsSync(copies)).toBe(true);
    });

    it("states the cost only when the download asks for it", async () => {
        expect(await (await download("same-origin")).res.text()).not.toMatch(/cost of the model calls/i);
        expect(await (await download("same-origin", "?cost=1")).res.text()).toMatch(/cost of the model calls: \$0\.00/i);
    });

    it("serves a draft with the findings awaiting review only when the download asks for one", async () => {
        const seed = (projectId: string, repositoryId: string) =>
            createFinding(projectId, null, sampleFinding(repositoryId, { title: "Raw SQL" }));
        const final = (await download("same-origin", "", seed)).res;
        expect(final.headers.get("content-disposition")).not.toContain("draft");
        expect(await final.text()).not.toContain("Raw SQL");
        const draft = (await download("same-origin", "?draft=1", seed)).res;
        expect(draft.headers.get("content-disposition")).toMatch(/filename="auditdesk-acme-draft-\d{4}-\d{2}-\d{2}\.html"/);
        expect(await draft.text()).toContain("Raw SQL");
    });

    it("gives each finding's hours only when the download asks for them", async () => {
        const seed = async (projectId: string, repositoryId: string) => {
            const { id } = await createFinding(
                projectId,
                null,
                sampleFinding(repositoryId, { effort: "M", effortHours: { low: 2, high: 4 } })
            );
            await prisma.finding.update({ where: { id }, data: { status: "accepted" } });
        };
        const without = await (await download("same-origin", "", seed)).res.text();
        expect(without).toContain("effort M");
        expect(without).not.toContain("2–4 h");
        expect(await (await download("same-origin", "?hours=1", seed)).res.text()).toContain("effort M (2–4 h)");
    });

    it("refuses a request another site started, and writes no copy", async () => {
        const { res, copies } = await download("cross-site");
        expect(res.status).toBe(403);
        expect(existsSync(copies)).toBe(false);
    });
});

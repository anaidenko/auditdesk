import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

import { GET } from "./route";

beforeEach(resetDb);
afterEach(() => {
    delete process.env.WORKSPACE_DIR;
});

async function download(site: string) {
    const { project } = await projectWithRepo();
    process.env.WORKSPACE_DIR = await mkdtemp(join(tmpdir(), "ws-"));
    const res = await GET(new Request(`http://127.0.0.1/projects/${project.id}/report`, { headers: { "sec-fetch-site": site } }), {
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

    it("refuses a request another site started, and writes no copy", async () => {
        const { res, copies } = await download("cross-site");
        expect(res.status).toBe(403);
        expect(existsSync(copies)).toBe(false);
    });
});

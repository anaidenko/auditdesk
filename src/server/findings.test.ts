import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { resetDb } from "@/test/db";
import { projectWithRepo, sampleFinding } from "@/test/factories";

beforeEach(resetDb);

describe("createFinding", () => {
    it("numbers findings per project and never reuses a number", async () => {
        const { project: p, repo: r } = await projectWithRepo();
        const first = await createFinding(p.id, null, sampleFinding(r.id));
        await prisma.finding.delete({ where: { id: first.id } });
        const second = await createFinding(p.id, null, sampleFinding(r.id));
        expect([first.label, second.label]).toEqual(["F-001", "F-002"]);
    });

    it("hands out distinct numbers to concurrent creators", async () => {
        const { project: p, repo: r } = await projectWithRepo();
        const made = await Promise.all(Array.from({ length: 10 }, () => createFinding(p.id, null, sampleFinding(r.id))));
        expect(new Set(made.map(m => m.number)).size).toBe(10);
    });
});

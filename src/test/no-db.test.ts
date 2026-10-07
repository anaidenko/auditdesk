import { describe, expect, it } from "vitest";

import { prisma } from "@/server/db";

describe("a unit file", () => {
    it("cannot reach the test database", () => {
        expect(() => prisma.project).toThrow(/no-db\.test\.ts reaches the test database: move it under a "db" glob/);
    });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

describe("tooling", () => {
    it("binds dev and start to 127.0.0.1", () => {
        expect(pkg.scripts.dev).toContain("-H 127.0.0.1");
        expect(pkg.scripts.start).toContain("-H 127.0.0.1");
    });

    it("pins the Prisma CLI to the client's version", () => {
        expect(pkg.devDependencies.prisma).toBe(pkg.dependencies["@prisma/client"]);
    });
});

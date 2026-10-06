import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

    // .env.local holds live credentials; a test that resolved one could reach Anthropic. Booleans only: a failure must not print a value.
    it("hides the live credentials and the saved ones from every test", () => {
        expect(Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN)).toBe(false);
        expect(Boolean(process.env.ANTHROPIC_API_KEY)).toBe(false);
        expect(process.env.AUDITDESK_HOME?.startsWith(tmpdir())).toBe(true);
    });
});

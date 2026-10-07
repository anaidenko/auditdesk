import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { EMPTY_STACK, detectStack, stackProfileText, suggestAiBuilt, suggestAspects, suggestionsFor } from "./stack";

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
    JSON.stringify({ name: "app", dependencies: deps, devDependencies: dev }, null, 2);

describe("detectStack", () => {
    it("detects Next.js, Prisma and PostgreSQL", async () => {
        const root = await makeRepo({
            "package.json": pkg(
                { "next": "16.3.8", "react": "19.3.0", "@prisma/client": "7.10.0" },
                { prisma: "7.10.0", typescript: "5.9.0" }
            ),
            "tsconfig.json": "{}",
            "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id String @id\n}\n',
            "src/app/page.tsx": "export default function Page() { return null; }\n"
        });
        const s = await detectStack(root);
        expect(s.frameworks).toEqual(expect.arrayContaining(["Next.js 16", "React 19"]));
        expect(s.orms).toEqual(["Prisma"]);
        expect(s.databases).toEqual(["PostgreSQL"]);
        expect(s.languages[0]).toMatch(/^TypeScript/);
    });

    it("detects Angular and Ionic with Capacitor", async () => {
        const root = await makeRepo({
            "package.json": pkg({ "@angular/core": "^18.2.0", "@ionic/angular": "^8.0.0", "@capacitor/core": "6.1.0" }),
            "src/app/app.component.ts": "export class AppComponent {}\n"
        });
        expect((await detectStack(root)).frameworks).toEqual(expect.arrayContaining(["Angular 18", "Ionic 8 (Angular)", "Capacitor 6"]));
    });

    it("detects Express with pg", async () => {
        const root = await makeRepo({
            "package.json": pkg({ express: "^4.19.2", pg: "^8.11.0" }),
            "src/server.js": "require('express');\n"
        });
        const s = await detectStack(root);
        expect(s.frameworks).toContain("Express 4");
        expect(s.databases).toEqual(["PostgreSQL"]);
        expect(s.languages).toEqual(["JavaScript (1 file)"]);
    });

    it("lists Python as not covered, never as analysed", async () => {
        const root = await makeRepo({
            "package.json": pkg({ react: "19.0.0" }),
            "web/App.jsx": "export default 1;\n",
            "api/requirements.txt": "fastapi==0.115.0\n",
            "api/main.py": "app = 1\n"
        });
        const s = await detectStack(root);
        expect(s.notCovered).toEqual(["Python (1 file; api/requirements.txt)"]);
        expect(s.languages.join()).not.toMatch(/Python/);
        expect(stackProfileText(s)).toMatch(/Not covered by this audit: Python/);
    });

    it("suggests the LLM aspect when an LLM SDK is a dependency", async () => {
        const root = await makeRepo({ "package.json": pkg({ "openai": "^4.0.0", "@anthropic-ai/sdk": "0.131.0" }), "index.js": "\n" });
        const s = await detectStack(root);
        expect(s.llmSdks).toEqual(["Anthropic SDK", "OpenAI SDK"]);
        expect(suggestAspects(s)).toEqual(["llm"]);
    });

    it("suggests multi-tenancy when the schema has tenant or organisation keys", async () => {
        const root = await makeRepo({
            "package.json": pkg({ "@prisma/client": "7.10.0" }),
            "prisma/schema.prisma": "model Project {\n  id String @id\n  organizationId String\n}\n",
            "db/migrations/001_init.sql": "CREATE TABLE invoice (id int, workspace_id int);\n",
            "src/index.ts": "\n"
        });
        const s = await detectStack(root);
        expect(s.tenancyHints).toEqual(["organizationId (prisma/schema.prisma)", "workspace_id (db/migrations/001_init.sql)"]);
        expect(suggestAspects(s)).toEqual(["tenancy"]);
    });

    it("takes a store or shop key for a tenant, as on a storefront platform", async () => {
        const root = await makeRepo({
            "package.json": pkg({ "@prisma/client": "6.8.2" }),
            "prisma/schema.prisma": "model Store {\n  id String @id\n}\nmodel Product {\n  storeId String\n}\n",
            "src/index.ts": "\n"
        });
        const s = await detectStack(root);
        expect(s.tenancyHints).toEqual(["model Store (prisma/schema.prisma)", "storeId (prisma/schema.prisma)"]);
        expect(suggestAspects(s)).toEqual(["tenancy"]);
    });

    it("does not take an authentication library's account model for tenancy", async () => {
        const root = await makeRepo({
            "package.json": pkg({ "next-auth": "^4.24.0" }),
            "prisma/schema.prisma": "model Account {\n  userId String\n  providerAccountId String\n}\n",
            "src/index.ts": "\n"
        });
        const s = await detectStack(root);
        expect(s.tenancyHints).toEqual([]);
        expect(s.auth).toEqual(["Auth.js (NextAuth)"]);
    });

    it("suggests the AI-built mode from agent instruction files", async () => {
        const root = await makeRepo({
            "package.json": pkg({}),
            ".cursorrules": "Use tabs.\n",
            "CLAUDE.md": "# Project\n",
            ".github/copilot-instructions.md": "Be brief.\n",
            "index.js": "\n"
        });
        const s = await detectStack(root);
        expect(s.aiBuiltSigns).toEqual([".cursorrules", ".github/copilot-instructions.md", "CLAUDE.md"]);
        expect(suggestAiBuilt(s)).toBe(true);
    });

    it("never reads a file outside the manifests it lists", async () => {
        const root = await makeRepo({
            "package.json": pkg({ next: "16.0.0" }),
            "apps/api/package.json": pkg({ express: "5.0.0" }),
            "prisma/schema.prisma": "model A {\n  id String @id\n}\n",
            "src/secret-config.ts": 'export const key = "do not read";\n',
            ".env.example": "DATABASE_URL=\n"
        });
        const read: string[] = [];
        const s = await detectStack(root, {
            read: async rel => {
                read.push(rel);
                return readFile(`${root}/${rel}`, "utf8");
            }
        });
        expect(read.length).toBeGreaterThan(0);
        expect(read.every(r => s.manifests.includes(r))).toBe(true);
        expect(read).not.toContain("src/secret-config.ts");
        expect(s.frameworks).toEqual(expect.arrayContaining(["Next.js 16", "Express 5"]));
    });
});

describe("detectStack on larger repositories", () => {
    it("keeps the profile of a multi-tenant app with many migrations under the brief's 4,000-character cap", async () => {
        const migrations = Object.fromEntries(
            Array.from({ length: 45 }, (_, i) => [
                `prisma/migrations/20250101${String(i).padStart(4, "0")}_change_${i}/migration.sql`,
                `ALTER TABLE "Invoice" ADD COLUMN "organizationId" TEXT;\nALTER TABLE "Team" ADD COLUMN "workspace_id" TEXT;\n`
            ])
        );
        const root = await makeRepo({
            "package.json": pkg({ "@prisma/client": "7.10.0" }),
            "prisma/schema.prisma": "model Organization {\n  id String @id\n}\nmodel Invoice {\n  organizationId String\n}\n",
            "src/index.ts": "\n",
            ...migrations
        });
        const s = await detectStack(root);
        const text = stackProfileText(s);
        expect(text.length).toBeLessThan(4000);
        expect(text).toMatch(/40 SQL migrations under prisma\/migrations/);
        expect(text).toMatch(/organizationId \(prisma\/schema\.prisma and \d+ more\)/);
        expect(suggestAspects(s)).toEqual(["tenancy"]);
    });

    it("marks what only devDependencies list as dev only, and suggests no LLM aspect for it", async () => {
        const root = await makeRepo({
            "package.json": pkg(
                { "react": "19.0.0", "@prisma/client": "7.10.0" },
                { express: "^4.19.0", pg: "^8.11.0", openai: "^4.0.0", prisma: "7.10.0" }
            ),
            "src/App.tsx": "\n"
        });
        const s = await detectStack(root);
        expect(s.frameworks).toEqual(["Express 4 (dev only)", "React 19"]);
        expect(s.databases).toEqual(["PostgreSQL (dev only)"]);
        expect(s.orms).toEqual(["Prisma"]);
        expect(s.llmSdks).toEqual(["OpenAI SDK (dev only)"]);
        expect(suggestAspects(s)).toEqual([]);
    });

    it("leaves out manifests and sources under examples, fixtures, vendor and build folders", async () => {
        const root = await makeRepo({
            "package.json": pkg({ react: "19.0.0" }),
            "src/App.tsx": "\n",
            "examples/chatbot/package.json": pkg({ ai: "4.0.0", openai: "4.0.0" }),
            "test/fixtures/api/package.json": pkg({ express: "4.0.0" }),
            "vendor/lib/thing.go": "package lib\n"
        });
        const s = await detectStack(root);
        expect(s.llmSdks).toEqual([]);
        expect(s.frameworks).toEqual(["React 19"]);
        expect(s.notCovered).toEqual([]);
        expect(s.manifests).toEqual(["package.json"]);
    });

    it("prefers the root manifest's version in a monorepo", async () => {
        const root = await makeRepo({
            "apps/legacy/package.json": pkg({ next: "13.5.0" }),
            "package.json": pkg({ next: "16.0.0" }),
            "src/a.ts": "\n"
        });
        expect((await detectStack(root)).frameworks).toEqual(["Next.js 16"]);
    });

    it("finds agent instruction files at any depth and in rule folders", async () => {
        const root = await makeRepo({
            "package.json": pkg({}),
            "apps/web/CLAUDE.md": "# Web\n",
            ".clinerules/style.md": "x\n",
            ".windsurf/rules/a.md": "x\n",
            ".github/instructions/ts.instructions.md": "x\n",
            "index.js": "\n"
        });
        expect((await detectStack(root)).aiBuiltSigns).toEqual([
            ".clinerules",
            ".github/instructions",
            ".windsurf/rules",
            "apps/web/CLAUDE.md"
        ]);
    });

    it("skips a file too large to be a manifest without reading it", async () => {
        const root = await makeRepo({
            "package.json": pkg({}),
            "db/migrations/001_seed.sql": "INSERT INTO t VALUES (1);\n".repeat(120_000),
            "index.js": "\n"
        });
        expect((await detectStack(root)).manifests).toEqual(["package.json"]);
    });
});

describe("suggestionsFor", () => {
    it("joins the suggestions of every repository with a detected stack", () => {
        const front = { ...EMPTY_STACK, llmSdks: ["OpenAI SDK"], aiBuiltSigns: [".cursorrules"] };
        const back = { ...EMPTY_STACK, tenancyHints: ["schema.prisma: orgId"], aiBuiltSigns: [".cursorrules", "CLAUDE.md"] };
        expect(suggestionsFor([front, null, back])).toEqual({
            aspects: ["llm", "tenancy", "seams"],
            aiBuiltSigns: [".cursorrules", "CLAUDE.md"]
        });
    });
});

describe("the seams suggestion", () => {
    it("suggests the seams pass when the project has more than one repository", () => {
        expect(suggestionsFor([EMPTY_STACK, EMPTY_STACK]).aspects).toContain("seams");
        expect(suggestionsFor([EMPTY_STACK]).aspects).not.toContain("seams");
        expect(suggestionsFor([null, null]).aspects).not.toContain("seams");
    });
});

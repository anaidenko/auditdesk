import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { parseChecklist } from "../checklists";
import { Masker } from "../masker";
import { MemorySink } from "../memory-sink";

import { type AgentContext, toolSpecs } from "./tools";
import { makeTools } from "./tools";

const ctx = {
    clonePath: "/nonexistent",
    repositoryId: "r",
    agentRunId: "a",
    aspect: "security",
    checklist: parseChecklist("security", "# Security\n\n## SEC-01 Item\n"),
    masker: new Masker([]),
    repoMap: "",
    sink: new MemorySink(),
    state: { finished: null, reported: [], fatal: null }
};

describe("makeTools", () => {
    // The cached prefix starts with these definitions (design § 8): a refactor must not move a byte.
    it("declares the same seven tools as before the shared specs, byte for byte", async () => {
        type Declared = { name: string; description: string; input_schema: unknown; strict: boolean };
        const declared = makeTools(ctx).map(t => {
            const { name, description, input_schema, strict } = t as unknown as Declared;
            return { name, description, input_schema, strict };
        });
        await expect(JSON.stringify(declared, null, 2)).toMatchFileSnapshot("./__snapshots__/tools.json");
    });
});

describe("a cross-repository agent's tools", () => {
    async function seams() {
        const web = await makeRepo({ "src/api.ts": "export const getUser = id => fetch(`/api/users/${id}`);\n", "package.json": "{}\n" });
        const api = await makeRepo({ "src/routes.ts": 'app.get("/api/users/:id", handler);\napp.delete("/api/users/:id", remove);\n' });
        const sink = new MemorySink();
        await sink.createFinding({
            repositoryId: "r-api",
            agentRunId: null,
            aspect: "security",
            kind: "finding",
            checklistItem: "SEC-03",
            title: "No owner check",
            severity: "high",
            likelihood: null,
            impact: null,
            summary: "s",
            explanation: "e",
            recommendation: "r",
            effort: "S",
            references: {},
            tags: [],
            source: "scanner",
            fingerprint: "f",
            evidence: [{ file: "src/routes.ts", startLine: 1, endLine: 1 }]
        });
        const c: AgentContext = {
            ...ctx,
            clonePath: web,
            repositoryId: "r-web",
            aspect: "seams",
            checklist: parseChecklist("seams", "# Seams\n\n## SEA-01 Contract\n"),
            sink,
            roots: [
                { name: "web", clonePath: web, repositoryId: "r-web" },
                { name: "api", clonePath: api, repositoryId: "r-api" }
            ],
            state: { finished: null, reported: [], fatal: null }
        };
        const run = (name: string, args: object) =>
            toolSpecs(c)
                .find(t => t.name === name)!
                .run(args as never);
        return { c, sink, run };
    }

    it("lists the repositories at the root, and every path under its repository's name", async () => {
        const { run } = await seams();
        expect(await run("list_files", { dir: ".", glob: "" })).toBe("web/ (repository)\napi/ (repository)");
        expect(await run("list_files", { dir: "api", glob: "" })).toMatch(/^api\/src\/routes\.ts \(\d+ bytes\)$/);
        expect(await run("list_files", { dir: ".", glob: "**/*.ts" })).toMatch(/web\/src\/api\.ts [^\n]*\napi\/src\/routes\.ts/);
    });

    it("reads and searches across the repositories, and refuses a path outside them", async () => {
        const { run } = await seams();
        expect(await run("read_file", { path: "api/src/routes.ts", start_line: 2, end_line: 2 })).toMatch(
            /^api\/src\/routes\.ts, lines 2-2 of 3\n2\| app\.delete/
        );
        expect(await run("grep", { pattern: "/api/users", glob: "" })).toBe(
            [
                "web/src/api.ts:1: export const getUser = id => fetch(`/api/users/${id}`);",
                'api/src/routes.ts:1: app.get("/api/users/:id", handler);',
                'api/src/routes.ts:2: app.delete("/api/users/:id", remove);'
            ].join("\n")
        );
        expect(await run("grep", { pattern: "/api/users", glob: "api/**" })).not.toContain("web/");
        await expect(run("read_file", { path: "src/routes.ts", start_line: 1, end_line: 1 })).rejects.toThrow(
            /Start the path with a repository's name: web\/, api\//
        );
        await expect(run("read_file", { path: "../etc/passwd", start_line: 1, end_line: 1 })).rejects.toThrow(/Start the path/);
        await expect(run("read_file", { path: "api/../../etc/passwd", start_line: 1, end_line: 1 })).rejects.toThrow(/leaves the/);
    });

    it("lists every repository's scanner results, and files a finding with evidence in both under no single repository", async () => {
        const { run, sink } = await seams();
        expect(await run("scanner_results", { aspect: "security" })).toMatch(
            /^api: F-001 \[high\] SEC-03 src\/routes\.ts:1 No owner check$/m
        );
        const out = await run("report_finding", {
            kind: "finding",
            checklist_item: "SEA-01",
            title: "The front end calls a route with no owner check",
            severity: "high",
            likelihood: "l",
            impact: "i",
            summary: "s",
            explanation: "e",
            recommendation: "r",
            effort: "S",
            evidence: [
                { file: "web/src/api.ts", start_line: 1, end_line: 1 },
                { file: "api/src/routes.ts", start_line: 1, end_line: 1 }
            ],
            cwe: "",
            tags: []
        });
        expect(out).toBe("Filed F-002.");
        const f = sink.findings[1];
        expect(f.repositoryId).toBeNull();
        expect(f.evidence.map(e => e.file)).toEqual(["web/src/api.ts", "api/src/routes.ts"]);
        expect(f.evidence[1].snippet).toBe('app.get("/api/users/:id", handler);');
    });
});

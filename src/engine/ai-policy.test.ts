import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { AUDITOR, NO_POLICY, areasOf, checkReadable, excludedBy, readAiPolicy, summarizePolicy } from "./ai-policy";

async function tree(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "policy-"));
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
    }
    return root;
}

const settings = (deny: string[]) => JSON.stringify({ permissions: { allow: ["Read(./src/**)"], deny } }, null, 2);

describe("readAiPolicy: Claude Code's Read rules", () => {
    it("reads the Read rules of both project settings, with their lines, and leaves other tools' rules out", async () => {
        const root = await tree({
            ".claude/settings.json": settings(["Bash(rm:*)", "Read(./certs/**)", "Edit(./certs/**)", "Read(.env)"]),
            ".claude/settings.local.json": settings(["Read(/local.key)"])
        });
        const p = await readAiPolicy(root);
        expect(p.sources).toEqual([
            {
                file: ".claude/settings.json",
                tool: "Claude Code",
                patterns: [
                    { line: 8, pattern: "Read(./certs/**)" },
                    { line: 10, pattern: "Read(.env)" }
                ]
            },
            { file: ".claude/settings.local.json", tool: "Claude Code", patterns: [{ line: 7, pattern: "Read(/local.key)" }] }
        ]);
        expect(p.warnings).toEqual([]);
        expect(p.readsNothing).toBeNull();
    });

    it("anchors /path and path at the repository root, a bare name at any depth, and a one-segment directory rule at any depth", async () => {
        const p = await readAiPolicy(
            await tree({
                ".claude/settings.json": settings([
                    "Read(./certs/**)",
                    "Read(secrets/**)",
                    "Read(/config/prod.json)",
                    "Read(src/keys.ts)",
                    "Read(.env)",
                    "Read(**/*.p12)"
                ])
            })
        );
        const excluded = (rel: string) => !!p.match(rel);
        expect(excluded("certs/server.key")).toBe(true);
        expect(excluded("packages/api/certs/server.key")).toBe(true);
        expect(excluded("certs-old/server.key")).toBe(false);
        expect(excluded("deep/a/secrets/token.txt")).toBe(true);
        expect(excluded("config/prod.json")).toBe(true);
        expect(excluded("api/config/prod.json")).toBe(false);
        expect(excluded("src/keys.ts")).toBe(true);
        expect(excluded("lib/src/keys.ts")).toBe(false);
        expect(excluded(".env")).toBe(true);
        expect(excluded("api/.env")).toBe(true);
        expect(excluded("a/b/store.p12")).toBe(true);
        expect(excluded("src/index.ts")).toBe(false);
    });

    it("lists // and ~/ rules as outside the repository, excluding nothing", async () => {
        const p = await readAiPolicy(await tree({ ".claude/settings.json": settings(["Read(//etc/passwd)", "Read(~/.ssh/**)"]) }));
        expect(p.sources[0].patterns.map(x => x.note)).toEqual([
            "outside the repository, not applicable",
            "outside the repository, not applicable"
        ]);
        expect(p.match("etc/passwd")).toBeNull();
        expect(p.match(".ssh/id_rsa")).toBeNull();
    });

    it("carves a negation out of earlier path rules of its own file only, never out of /-anchored ones, and not when listed first", async () => {
        const p = await readAiPolicy(
            await tree({
                ".claude/settings.json": settings([
                    "Read(!docs/readme.md)",
                    "Read(docs/**)",
                    "Read(certs/**)",
                    "Read(!certs/public.pem)",
                    "Read(/keys/**)",
                    "Read(!keys/ok.pem)"
                ]),
                ".cursorignore": "!vault/open.txt\n",
                ".claude/settings.local.json": settings(["Read(vault/**)"])
            })
        );
        expect(p.match("docs/readme.md")).not.toBeNull();
        expect(p.match("certs/server.key")).not.toBeNull();
        expect(p.match("certs/public.pem")).toBeNull();
        expect(p.match("keys/ok.pem")).not.toBeNull();
        expect(p.match("vault/open.txt")?.file).toBe(".claude/settings.local.json");
    });

    it("reads a bare Read deny as no file may be read", async () => {
        const p = await readAiPolicy(await tree({ ".claude/settings.json": settings(["Read"]) }));
        expect(p.readsNothing).toBe(".claude/settings.json:7");
        expect(p.sources[0].patterns).toEqual([{ line: 7, pattern: "Read", note: "no file may be read" }]);
        expect(p.match("src/index.ts")?.file).toBe(".claude/settings.json");
    });

    it("warns about a settings file that is not JSON, and reads the other", async () => {
        const p = await readAiPolicy(
            await tree({ ".claude/settings.json": "{ permissions: ", ".claude/settings.local.json": settings(["Read(.env)"]) })
        );
        expect(p.warnings).toEqual([".claude/settings.json is not valid JSON: its Read rules could not be read."]);
        expect(p.sources.map(s => s.file)).toEqual([".claude/settings.local.json"]);
    });

    it("guards the literal path of a pattern that is not a usable gitignore pattern, with a warning", async () => {
        const p = await readAiPolicy(await tree({ ".claude/settings.json": settings(["Read(./private[1/**)"]) }));
        expect(p.sources[0].patterns[0].note).toBe("not a usable pattern; it guards its literal path");
        expect(p.warnings).toEqual([
            '.claude/settings.json:7: "Read(./private[1/**)" is not a usable gitignore pattern; it guards its literal path only.'
        ]);
        expect(p.match("private[1/**")).not.toBeNull();
        expect(p.match("private[1/a.txt")).toBeNull();
        const q = await readAiPolicy(await tree({ ".claude/settings.json": settings(["Read(vault[2)"]) }));
        expect(q.match("vault[2")).not.toBeNull();
        expect(q.match("vault[2/key.txt")).not.toBeNull();
        expect(q.match("vault2")).toBeNull();
    });

    it("matches without regard to case, as the clone's file system opens TLS/ for tls/", async () => {
        const p = await readAiPolicy(await tree({ ".claude/settings.json": settings(["Read(./tls/**)"]) }));
        expect(p.match("TLS/server.key")).not.toBeNull();
    });
});

describe("readAiPolicy: other tools' ignore files", () => {
    it("reads each tool's ignore file at the root with gitignore syntax, skipping comments and blank lines", async () => {
        const p = await readAiPolicy(
            await tree({
                ".cursorignore": "# Cursor\n\nsecrets/\n",
                ".cursorindexingignore": "everything-indexed/\n",
                ".aiexclude": "*.pem\n",
                ".geminiignore": "/build.key\n",
                ".aiignore": "tokens.json\n",
                ".codeiumignore": "private/**\n",
                ".aiderignore": "notes.md\n"
            })
        );
        expect(p.sources.map(s => [s.file, s.tool, s.patterns])).toEqual([
            [".aiderignore", "Aider", [{ line: 1, pattern: "notes.md" }]],
            [".aiexclude", "Gemini Code Assist", [{ line: 1, pattern: "*.pem" }]],
            [".aiignore", "JetBrains AI Assistant and Junie", [{ line: 1, pattern: "tokens.json" }]],
            [".codeiumignore", "Windsurf", [{ line: 1, pattern: "private/**" }]],
            [".cursorignore", "Cursor", [{ line: 3, pattern: "secrets/" }]],
            [".geminiignore", "Gemini CLI", [{ line: 1, pattern: "/build.key" }]]
        ]);
        expect(p.match("a/secrets/x")?.file).toBe(".cursorignore");
        expect(p.match("everything-indexed/x")).toBeNull();
        expect(p.match("build.key")?.file).toBe(".geminiignore");
        expect(p.match("lib/build.key")).toBeNull();
        expect(p.match("private/a/b.txt")?.file).toBe(".codeiumignore");
    });

    it("keeps git's negation inside an ignore file, /-anchored rules included", async () => {
        const p = await readAiPolicy(await tree({ ".aiignore": "/keys/*\n!/keys/ok.pem\n" }));
        expect(p.match("keys/server.pem")).not.toBeNull();
        expect(p.match("keys/ok.pem")).toBeNull();
    });

    it("anchors a nested ignore file at its own directory, and marks it nested unless its tool reads nested files", async () => {
        const p = await readAiPolicy(
            await tree({
                "packages/api/.cursorignore": "config.json\n/root-only.txt\n",
                "packages/web/.aiexclude": "*.key\n",
                "config.json": "{}",
                "node_modules/x/.cursorignore": "*\n"
            })
        );
        expect(p.sources.map(s => [s.file, s.nested ?? false])).toEqual([
            ["packages/api/.cursorignore", true],
            ["packages/web/.aiexclude", false]
        ]);
        expect(p.match("packages/api/config.json")).not.toBeNull();
        expect(p.match("packages/api/sub/config.json")).not.toBeNull();
        expect(p.match("config.json")).toBeNull();
        expect(p.match("packages/api/root-only.txt")).not.toBeNull();
        expect(p.match("packages/api/sub/root-only.txt")).toBeNull();
        expect(p.match("packages/web/a.key")).not.toBeNull();
        expect(p.match("packages/api/a.key")).toBeNull();
    });

    it("honours a .claudeignore as the team's intent, which no tool enforces", async () => {
        const p = await readAiPolicy(await tree({ ".claudeignore": "drafts/\n" }));
        expect(p.sources).toEqual([
            { file: ".claudeignore", tool: "no tool (intent)", intent: true, patterns: [{ line: 1, pattern: "drafts/" }] }
        ]);
        expect(p.match("drafts/a.md")).not.toBeNull();
    });

    it("warns about an empty .aiexclude, which excludes nothing here", async () => {
        const p = await readAiPolicy(await tree({ "app/.aiexclude": "\n# nothing\n" }));
        expect(p.sources).toEqual([]);
        expect(p.warnings).toEqual([
            "app/.aiexclude has no patterns; Android Studio reportedly reads an empty one as excluding everything below it (unverified). Nothing is excluded by it here."
        ]);
    });
});

describe("readAiPolicy: the auditor's own patterns", () => {
    it("adds them as a source of their own, anchored at the root, with gitignore syntax", async () => {
        const p = await readAiPolicy(await tree({}), { auditor: "# from the client's email\npayments/**\n\n*.sql\n" });
        expect(p.sources).toEqual([
            {
                file: AUDITOR,
                tool: "the auditor",
                patterns: [
                    { line: 2, pattern: "payments/**" },
                    { line: 4, pattern: "*.sql" }
                ]
            }
        ]);
        expect(p.match("payments/stripe.ts")?.file).toBe(AUDITOR);
        expect(p.match("lib/payments/stripe.ts")).toBeNull();
        expect(p.match("db/seed.sql")?.file).toBe(AUDITOR);
    });

    it("is empty with no file and no pattern", async () => {
        const p = await readAiPolicy(await tree({ "src/a.ts": "" }), { auditor: "  \n" });
        expect(p.sources).toEqual([]);
        expect(p.match("src/a.ts")).toBeNull();
        expect(NO_POLICY.match("src/a.ts")).toBeNull();
    });
});

describe("excludedBy and checkReadable", () => {
    it("matches the path as asked and the path it resolves to", async () => {
        const p = await readAiPolicy(await tree({ ".claude/settings.json": settings(["Read(./tls/**)"]) }));
        expect(excludedBy(p, "web/server.key", "tls/server.key")?.file).toBe(".claude/settings.json");
        expect(excludedBy(p, "tls/server.key", "certs/server.key")?.file).toBe(".claude/settings.json");
        expect(excludedBy(p, "./tls//server.key")).not.toBeNull();
        expect(excludedBy(p, "src/../tls/server.key")).not.toBeNull();
        expect(excludedBy(p, "src/a.ts", "src/a.ts")).toBeNull();
    });

    it("refuses a symlink into an excluded directory, and a path in it that does not exist, before naming either", async () => {
        const root = await tree({
            ".claude/settings.json": settings(["Read(./tls/**)"]),
            "tls/server.key": "-----BEGIN PRIVATE KEY-----\n",
            "src/a.ts": "export {};\n"
        });
        await symlink(join(root, "tls"), join(root, "certs"));
        await symlink(join(root, "tls/server.key"), join(root, "key.pem"));
        const p = await readAiPolicy(root);
        await expect(checkReadable(p, root, "certs/server.key")).rejects.toThrow(
            "certs/server.key is excluded by the client's AI policy (.claude/settings.json)."
        );
        await expect(checkReadable(p, root, "key.pem")).rejects.toThrow(/key\.pem is excluded by the client's AI policy/);
        await expect(checkReadable(p, root, "tls/missing.key")).rejects.toThrow(/excluded by the client's AI policy/);
        expect((await checkReadable(p, root, "src/a.ts")).rel).toBe("src/a.ts");
        await expect(checkReadable(undefined, root, "certs/server.key")).resolves.toMatchObject({ rel: "tls/server.key" });
    });
});

describe("areasOf", () => {
    it("shows a directory whose every file is excluded as one area with its count, and other excluded files by name", () => {
        const rels = ["certs/a.pem", "certs/sub/b.pem", "config/.env", "config/app.json", "src/x.ts"];
        const excluded = (rel: string) => rel.startsWith("certs/") || rel.endsWith(".env");
        expect(areasOf(rels, excluded)).toEqual([
            { area: "certs/", files: 2 },
            { area: "config/.env", files: 1 }
        ]);
        expect(areasOf(rels, excluded, "certs").map(a => a.area)).toEqual(["certs/"]);
        expect(areasOf(rels, excluded, "certs/sub").map(a => a.area)).toEqual(["certs/sub/"]);
        expect(areasOf(rels, () => false)).toEqual([]);
    });
});

describe("summarizePolicy", () => {
    it("counts the files each source excludes and the files excluded in all, and lists their areas", async () => {
        const root = await tree({
            ".claude/settings.json": settings(["Read(./certs/**)", "Read(.env)"]),
            ".cursorignore": "*.pem\n",
            "certs/a.pem": "",
            "certs/b.key": "",
            "src/x.ts": "",
            "src/y.pem": "",
            "api/.env": ""
        });
        const s = await summarizePolicy(await readAiPolicy(root), root);
        expect(s.sources.map(x => [x.file, x.excludedFiles])).toEqual([
            [".claude/settings.json", 3],
            [".cursorignore", 2]
        ]);
        expect(s.excludedFiles).toBe(4);
        expect(s.files).toBe(7);
        expect(s.excluded).toEqual(["api/.env", "certs/ (2 files)", "src/y.pem"]);
        expect(s.everything).toBe(false);
    });

    it("says the policy excludes everything for a bare Read deny, and for patterns that cover every file", async () => {
        const bare = await tree({ ".claude/settings.json": settings(["Read"]), "src/a.ts": "" });
        expect((await summarizePolicy(await readAiPolicy(bare), bare)).everything).toBe(true);
        const all = await tree({ ".aiignore": "*\n", "src/a.ts": "" });
        expect((await summarizePolicy(await readAiPolicy(all), all)).everything).toBe(true);
        const none = await tree({ "src/a.ts": "" });
        expect(await summarizePolicy(await readAiPolicy(none), none)).toMatchObject({ everything: false, excludedFiles: 0, sources: [] });
    });

    it("lists at most 100 areas, then how many more", async () => {
        const files = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`k${String(i).padStart(3, "0")}.pem`, ""]));
        const root = await tree({ ".aiignore": "*.pem\n", "src/a.ts": "", ...files });
        const s = await summarizePolicy(await readAiPolicy(root), root);
        expect(s.excluded).toHaveLength(101);
        expect(s.excluded.at(-1)).toBe("and 20 more");
    });
});

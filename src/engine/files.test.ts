import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { CANARY, makePolicyRepo } from "@/test/policy-repo";

import { readAiPolicy } from "./ai-policy";
import { LIMITS, grepFiles, listFiles, readFileRange } from "./files";

let root: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "files-"));
    await mkdir(join(root, "src/routes"), { recursive: true });
    await mkdir(join(root, "node_modules/x"), { recursive: true });
    await writeFile(join(root, "src/routes/login.ts"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
    await writeFile(join(root, "src/app.ts"), "const q = `SELECT * FROM users WHERE id = ${req.params.id}`;\n");
    await writeFile(join(root, "node_modules/x/index.js"), "SELECT");
    await writeFile(join(root, "bundle.min.js"), "x".repeat(LIMITS.grepFileBytes + 1));
    await writeFile(join(root, "long.js"), "y".repeat(5000));
    await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]));
    await symlink("/etc", join(root, "etc-link"));
});

describe("listFiles", () => {
    it("lists files with sizes and skips dependency folders", async () => {
        const out = await listFiles(root);
        expect(out).toContain("src/routes/login.ts");
        expect(out).not.toContain("node_modules");
    });

    it("answers a file path with a tool error the model can act on", async () => {
        await expect(listFiles(root, { dir: "src/app.ts" })).rejects.toThrow(/is a file; use read_file/);
    });

    it("lists a symlink without following it", async () => {
        expect(await listFiles(root)).toMatch(/etc-link -> symlink, not followed/);
    });

    it("says when the list was cut", async () => {
        expect(await listFiles(root, { limit: 2 })).toMatch(/more files not shown/);
    });
});

describe("readFileRange", () => {
    it("returns numbered lines", async () => {
        expect(await readFileRange(root, "src/routes/login.ts", 2, 3)).toBe("src/routes/login.ts, lines 2-3 of 30\n2| line 2\n3| line 3");
    });

    it("clamps the range to the file", async () => {
        expect(await readFileRange(root, "src/routes/login.ts", 29, 99)).toContain("lines 29-30 of 30");
    });

    it(`reads at most ${LIMITS.readLines} lines per call`, async () => {
        await writeFile(join(root, "big.ts"), Array.from({ length: 1000 }, () => "z").join("\n"));
        expect(await readFileRange(root, "big.ts", 1, 1000)).toContain(`lines 1-${LIMITS.readLines} of 1000`);
    });

    it("cuts a very long line and says how long it was", async () => {
        expect(await readFileRange(root, "long.js", 1, 1)).toMatch(/\[line cut: 5000 characters\]/);
    });

    it("refuses a binary file", async () => {
        await expect(readFileRange(root, "logo.png", 1, 1)).rejects.toThrow(/binary/);
    });
});

describe("grepFiles", () => {
    it("stops a slow pattern at a deadline for the whole search, not only per file", async () => {
        const dir = await mkdtemp(join(tmpdir(), "redos-"));
        for (const n of [1, 2, 3]) await writeFile(join(dir, `${n}.txt`), `${"a".repeat(24)}b\n`);
        const started = Date.now();
        await expect(grepFiles(dir, "^(a+)+$", { timeoutMs: 2000, totalMs: 300 })).rejects.toThrow(/took too long/);
        expect(Date.now() - started).toBeLessThan(900);
    });

    it("refuses a pattern that backtracks catastrophically, instead of blocking the app", async () => {
        const dir = await mkdtemp(join(tmpdir(), "redos-"));
        await writeFile(join(dir, "a.txt"), `${"a".repeat(25)}b\n`);
        const started = Date.now();
        await expect(grepFiles(dir, "^(a+)+$", { timeoutMs: 100 })).rejects.toThrow(/took too long/);
        expect(Date.now() - started).toBeLessThan(600);
    });

    it("finds matches with file and line", async () => {
        expect(await grepFiles(root, "SELECT \\*")).toContain("src/app.ts:1:");
    });

    it("filters by glob", async () => {
        expect(await grepFiles(root, "line 1", { glob: "**/*.js" })).not.toContain("login.ts");
    });

    it("skips files over the size limit and counts them", async () => {
        expect(await grepFiles(root, "x")).toMatch(/1 file over 1000000 bytes skipped/);
    });

    it("explains an invalid pattern", async () => {
        await expect(grepFiles(root, "(")).rejects.toThrow(/Invalid regular expression/);
    });
});

describe("the client's AI policy in listFiles and grepFiles", () => {
    it("names an excluded file without its size, and shows a directory excluded as a whole as one line with its count", async () => {
        const repo = await makePolicyRepo();
        const policy = await readAiPolicy(repo);
        const out = (await listFiles(repo, { policy })).split("\n");
        expect(out).toEqual(
            expect.arrayContaining([
                ".env (excluded)",
                "api/.env (excluded)",
                "certs/ (excluded: 2 files)",
                "keys/ (excluded: 2 files)",
                "packages/api/certs/ (excluded: 1 file)",
                "store/client.p12 (excluded)",
                "vault/secret.txt (excluded)",
                "vault/README.md (8 bytes)"
            ])
        );
        expect(out.join("\n")).not.toMatch(/server\.key|dev\.key|private\.pem/);
    });

    it("answers a probe for a name inside a directory excluded as a whole the same, whether the name exists or not", async () => {
        const repo = await makePolicyRepo();
        await symlink(join(repo, "certs"), join(repo, "certs-link"));
        const policy = await readAiPolicy(repo);
        const areas = "certs/ (excluded: 2 files)\nkeys/ (excluded: 2 files)\npackages/api/certs/ (excluded: 1 file)";
        expect(await listFiles(repo, { policy, glob: "certs/server.key" })).toBe(areas);
        expect(await listFiles(repo, { policy, glob: "certs/nope.key" })).toBe(areas);
        expect(await listFiles(repo, { policy, glob: "src/*.js" })).toBe(`${areas}\nsrc/db.js (54 bytes)`);
        for (const dir of ["certs", "certs/nosuch", "packages/api/certs", "certs-link"])
            await expect(listFiles(repo, { policy, dir })).rejects.toThrow(
                `${dir} is excluded by the client's AI policy (.claude/settings.json).`
            );
        expect(await listFiles(repo, { policy, dir: "vault" })).toBe("vault/README.md (8 bytes)\nvault/secret.txt (excluded)");
        const note = "(9 files excluded by the client's AI policy were not searched)";
        expect(await grepFiles(repo, "x", { policy, glob: "certs/server.key" })).toBe(`No matches.\n${note}`);
        expect(await grepFiles(repo, "x", { policy, glob: "certs/nope.key" })).toBe(`No matches.\n${note}`);
    });

    it("searches no excluded file and says how many it skipped", async () => {
        const repo = await makePolicyRepo();
        const policy = await readAiPolicy(repo);
        expect(await grepFiles(repo, CANARY)).toContain(CANARY);
        expect(await grepFiles(repo, CANARY, { policy })).toBe(
            "No matches.\n(9 files excluded by the client's AI policy were not searched)"
        );
        expect(await grepFiles(repo, "SELECT", { policy, glob: "src/**" })).toBe(
            'src/db.js:1: db.query("SELECT * FROM u WHERE id=" + req.query.id);\n(9 files excluded by the client\'s AI policy were not searched)'
        );
    });
});

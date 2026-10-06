import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

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

import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { globToRegExp, resolveInClone } from "./paths";

let root: string;
let outside: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "clone-"));
    outside = await mkdtemp(join(tmpdir(), "outside-"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "src/a.ts"), "a");
    await writeFile(join(root, ".git/config"), "x");
    await writeFile(join(outside, "secret.env"), "KEY=1");
    await symlink(outside, join(root, "docs"));
    await symlink(join(root, "src"), join(root, "lib"));
});

describe("resolveInClone", () => {
    it("resolves a file inside the clone", async () => {
        expect((await resolveInClone(root, "src/a.ts")).rel).toBe("src/a.ts");
    });

    it("rejects a parent-directory path", async () => {
        await expect(resolveInClone(root, "../outside/secret.env")).rejects.toThrow(/leaves the repository/);
    });

    it("rejects a symlink that leaves the clone", async () => {
        await expect(resolveInClone(root, "docs/secret.env")).rejects.toThrow(/leaves the repository/);
    });

    it("follows a symlink that stays inside the clone", async () => {
        expect((await resolveInClone(root, "lib/a.ts")).rel).toBe("src/a.ts");
    });

    it("rejects an absolute path", async () => {
        await expect(resolveInClone(root, join(outside, "secret.env"))).rejects.toThrow(/relative/);
    });

    it("rejects the .git directory", async () => {
        await expect(resolveInClone(root, ".git/config")).rejects.toThrow(/\.git/);
    });

    it("says which path does not exist", async () => {
        await expect(resolveInClone(root, "src/missing.ts")).rejects.toThrow(/src\/missing\.ts/);
    });
});

describe("globToRegExp", () => {
    it("reads a brace with no closing brace as a literal", () => {
        expect(globToRegExp("*.{ts,tsx").test("a.{ts,tsx")).toBe(true);
    });

    it("expands wildcards inside braces", () => {
        expect(globToRegExp("{*.ts,*.js}").test("src/a.ts")).toBe(true);
        expect(globToRegExp("{*.ts,*.js}").test("src/a.css")).toBe(false);
    });

    it.each([
        ["**/*.ts", "src/a/b.ts", true],
        ["**/*.ts", "b.ts", true],
        ["src/*.ts", "src/a/b.ts", false],
        ["*.{ts,tsx}", "page.tsx", true],
        ["routes/?.js", "routes/a.js", true]
    ])("%s against %s is %s", (glob, path, expected) => {
        expect(globToRegExp(glob).test(path)).toBe(expected);
    });
});

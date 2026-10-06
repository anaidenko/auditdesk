import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { git } from "./git";
import { cloneRepository, deleteProjectClones, parseSource } from "./workspace";

async function ws() {
    return mkdtemp(join(tmpdir(), "auditdesk-ws-"));
}

describe("parseSource", () => {
    it.each([
        ["https://github.com/acme/app.git", "url"],
        ["git@github.com:acme/app.git", "url"],
        ["ssh://git@host/acme/app.git", "url"],
        ["/Users/me/app", "path"]
    ])("reads %s as a %s", (input, kind) => {
        expect(parseSource(input).kind).toBe(kind);
    });

    it.each(["--upload-pack=touch /tmp/x", "file:///etc", "http://example.com/a.git", "relative/path", ""])("refuses %j", input => {
        expect(() => parseSource(input)).toThrow();
    });
});

describe("cloneRepository", () => {
    it("clones a local path at the chosen branch and records its SHA", async () => {
        const src = await makeRepo({ "a.txt": "main" }, { branches: { feature: { "a.txt": "feature" } } });
        const dir = await ws();
        const { sha, clonePath } = await cloneRepository({
            source: src,
            branch: "feature",
            workspaceDir: dir,
            projectId: "p",
            repositoryId: "r"
        });
        expect(await readFile(join(clonePath, "a.txt"), "utf8")).toBe("feature");
        expect(sha).toBe(await git(["rev-parse", "feature"], src));
        expect(clonePath).toBe(join(dir, "p", `r@${sha}`));
    });

    it("leaves out uncommitted edits and ignored files of a local path", async () => {
        const src = await makeRepo(
            { "a.txt": "committed", ".gitignore": ".env.local\n" },
            { uncommitted: { "a.txt": "edited", ".env.local": "KEY=1" } }
        );
        const { clonePath } = await cloneRepository({
            source: src,
            branch: "main",
            workspaceDir: await ws(),
            projectId: "p",
            repositoryId: "r"
        });
        expect(await readFile(join(clonePath, "a.txt"), "utf8")).toBe("committed");
        expect(existsSync(join(clonePath, ".env.local"))).toBe(false);
    });

    it("fetches every branch, so history scans see all of them", async () => {
        const src = await makeRepo({ "a.txt": "x" }, { branches: { old: { "b.txt": "y" } } });
        const { clonePath } = await cloneRepository({
            source: src,
            branch: "main",
            workspaceDir: await ws(),
            projectId: "p",
            repositoryId: "r"
        });
        expect(await git(["branch", "-r"], clonePath)).toContain("origin/old");
    });

    it("checks out a recorded commit even after the branch has moved", async () => {
        const src = await makeRepo({ "a.txt": "first" });
        const first = await git(["rev-parse", "HEAD"], src);
        await git(["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "later"], src);
        const { sha } = await cloneRepository({
            source: src,
            branch: "main",
            sha: first,
            workspaceDir: await ws(),
            projectId: "p",
            repositoryId: "r"
        });
        expect(sha).toBe(first);
    });

    it("refuses a branch that does not exist, naming it", async () => {
        const src = await makeRepo({ "a.txt": "x" });
        await expect(
            cloneRepository({ source: src, branch: "nope", workspaceDir: await ws(), projectId: "p", repositoryId: "r" })
        ).rejects.toThrow(/nope/);
    });

    it("deletes a project's clones", async () => {
        const src = await makeRepo({ "a.txt": "x" });
        const dir = await ws();
        const { clonePath } = await cloneRepository({ source: src, branch: "main", workspaceDir: dir, projectId: "p", repositoryId: "r" });
        await deleteProjectClones(dir, "p");
        expect(existsSync(clonePath)).toBe(false);
    });
});

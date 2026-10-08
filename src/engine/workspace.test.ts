import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { git } from "./git";
import { cloneRepository, defaultBranch, deleteProjectClones, parseSource, withScratchClone } from "./workspace";

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

    it("refreshes the refs of a clone at the same commit, so a branch pushed since is scanned too", async () => {
        const src = await makeRepo({ "a.txt": "a" });
        const dir = await ws();
        const o = { source: src, branch: "main", workspaceDir: dir, projectId: "p", repositoryId: "r" };
        await cloneRepository(o);
        await git(["branch", "pushed-later"], src);
        const { clonePath } = await cloneRepository(o);
        expect(await git(["branch", "-r"], clonePath)).toContain("origin/pushed-later");
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

describe("withScratchClone", () => {
    it("reads the branch from a clone of its own, removed afterwards, beside a run's clone it never touches", async () => {
        const source = await makeRepo({ "package.json": "{}" }, { branches: { dev: { "dev.txt": "x" } } });
        const workspaceDir = await mkdtemp(join(tmpdir(), "ws-"));
        const run = await cloneRepository({ source, branch: "main", workspaceDir, projectId: "p", repositoryId: "r" });
        const seen = await withScratchClone({ source, branch: "dev", workspaceDir, projectId: "p" }, async dir =>
            existsSync(join(dir, "dev.txt"))
        );
        expect(seen).toBe(true);
        expect(await readdir(join(workspaceDir, "p"))).toEqual([run.clonePath.split("/").pop()]);
    });

    it("removes its clone when the work inside fails", async () => {
        const source = await makeRepo({ "a.txt": "a" });
        const workspaceDir = await mkdtemp(join(tmpdir(), "ws-"));
        await expect(
            withScratchClone({ source, branch: "main", workspaceDir, projectId: "p" }, async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");
        expect(await readdir(join(workspaceDir, "p"))).toEqual([]);
    });
});

describe("a client's repository as it comes", () => {
    afterEach(() => vi.unstubAllEnvs());

    // As Andrii's global git config has them: LFS required, through a git-lfs that is not installed.
    const lfsRequired = () => {
        vi.stubEnv("GIT_CONFIG_COUNT", "3");
        vi.stubEnv("GIT_CONFIG_KEY_0", "filter.lfs.required");
        vi.stubEnv("GIT_CONFIG_VALUE_0", "true");
        vi.stubEnv("GIT_CONFIG_KEY_1", "filter.lfs.process");
        vi.stubEnv("GIT_CONFIG_VALUE_1", "git-lfs-not-installed filter-process");
        vi.stubEnv("GIT_CONFIG_KEY_2", "filter.lfs.smudge");
        vi.stubEnv("GIT_CONFIG_VALUE_2", "git-lfs-not-installed smudge -- %f");
    };

    it("clones a repository whose files go through Git LFS, keeping them as committed: the clone runs no filter", async () => {
        const source = await makeRepo({ ".gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n", "data.bin": "as committed" });
        lfsRequired();
        const workspaceDir = await ws();
        const { clonePath } = await cloneRepository({ source, branch: "main", workspaceDir, projectId: "p", repositoryId: "r" });
        expect(await readFile(join(clonePath, "data.bin"), "utf8")).toBe("as committed");
        await withScratchClone({ source, branch: "main", workspaceDir, projectId: "p" }, async dir =>
            expect(await readFile(join(dir, "data.bin"), "utf8")).toBe("as committed")
        );
    });

    it("checks out a recorded commit after the client deleted its branch", async () => {
        const source = await makeRepo({ "a.txt": "a" }, { branches: { "release/1.2": { "r.txt": "r" } } });
        const audited = await git(["rev-parse", "release/1.2"], source);
        await git(["-c", "user.name=T", "-c", "user.email=t@example.com", "merge", "-q", "--ff-only", "release/1.2"], source);
        await git(["branch", "-q", "-D", "release/1.2"], source);
        const { sha } = await cloneRepository({
            source,
            branch: "release/1.2",
            sha: audited,
            workspaceDir: await ws(),
            projectId: "p",
            repositoryId: "r"
        });
        expect(sha).toBe(audited);
    });

    it("reads a repository's default branch, and gives null when the source cannot be read", async () => {
        const source = await makeRepo({ "a.txt": "a" });
        await git(["branch", "-q", "-m", "main", "master"], source);
        expect(await defaultBranch(source)).toBe("master");
        expect(await defaultBranch(join(source, "missing"))).toBeNull();
    });

    it("reads a local repository whose path holds a per cent sign as that path, not a decoded one", async () => {
        const made = await makeRepo({ "a.txt": "a" });
        const source = `${made}-100%41`;
        await rename(made, source);
        const seen = await withScratchClone({ source, branch: "main", workspaceDir: await ws(), projectId: "p" }, async dir =>
            existsSync(join(dir, "a.txt"))
        );
        expect(seen).toBe(true);
    });
});

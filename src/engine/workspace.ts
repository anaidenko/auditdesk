import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { expandHome } from "./config";
import { git } from "./git";

export type Source = { kind: "url"; url: string } | { kind: "path"; path: string };

export function parseSource(input: string): Source {
    const s = input.trim();
    if (/^(https:\/\/|ssh:\/\/|git@[\w.-]+:)/.test(s)) return { kind: "url", url: s };
    const path = expandHome(s);
    if (path && isAbsolute(path)) return { kind: "path", path };
    throw new Error("Use an https://, ssh:// or git@ URL, or an absolute path to a local repository.");
}

const BRANCH = /^(?!-)[\w./-]+$/;

export const isBranchName = (name: string) => BRANCH.test(name);

/**
 * A local path is cloned too, not read in place: uncommitted edits would make the recorded SHA
 * false, and the clone holds no gitignored `.env*` file (design § 6).
 */
export async function cloneRepository(o: {
    source: string;
    branch: string;
    sha?: string | null;
    workspaceDir: string;
    projectId: string;
    repositoryId: string;
}): Promise<{ sha: string; clonePath: string }> {
    const source = parseSource(o.source);
    if (!BRANCH.test(o.branch)) throw new Error(`Not a branch name: ${o.branch}`);
    if (source.kind === "path" && !existsSync(join(source.path, ".git"))) throw new Error(`No git repository at ${source.path}`);

    const projectDir = join(o.workspaceDir, o.projectId);
    const tmp = join(projectDir, `${o.repositoryId}.cloning`);
    await mkdir(projectDir, { recursive: true });
    await rm(tmp, { recursive: true, force: true });
    // --no-local: a local repository is read through git's transport, as a remote one is, never by
    // copying its .git, which a client's archive could have crafted (git's advice for CVE-2024-32004).
    await git([
        "clone",
        "--quiet",
        ...(source.kind === "path" ? ["--no-local"] : []),
        "--",
        source.kind === "url" ? source.url : source.path,
        tmp
    ]);
    // A recorded commit is enough: the client may have merged and deleted the branch it was on since.
    const branchThere = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${o.branch}`], tmp).then(
        () => true,
        () => false
    );
    if (branchThere) await git(["checkout", "--quiet", "-B", o.branch, `origin/${o.branch}`], tmp);
    else if (!o.sha) {
        await rm(tmp, { recursive: true, force: true });
        throw new Error(`Branch "${o.branch}" was not found in ${o.source}`);
    }
    if (o.sha) {
        if (!/^[0-9a-f]{7,40}$/.test(o.sha)) throw new Error(`Not a commit SHA: ${o.sha}`);
        await git(["checkout", "--quiet", "--detach", o.sha], tmp).catch(async () => {
            await rm(tmp, { recursive: true, force: true });
            throw new Error(`Commit ${o.sha} was not found in ${o.source}`);
        });
    }
    const sha = await git(["rev-parse", "HEAD"], tmp);
    const clonePath = join(projectDir, `${o.repositoryId}@${sha}`);
    // A clone at the same commit is replaced, not reused: its refs would miss branches pushed since,
    // and gitleaks scans every ref.
    await rm(clonePath, { recursive: true, force: true });
    await rename(tmp, clonePath);
    return { sha, clonePath };
}

/**
 * A shallow clone of a branch as it is now, in a folder of its own that is removed afterwards:
 * stack detection reads it while a run may be cloning the same repository (review of 2026-10-07).
 */
export async function withScratchClone<T>(
    o: { source: string; branch: string; workspaceDir: string; projectId: string },
    work: (dir: string) => Promise<T>
): Promise<T> {
    const source = parseSource(o.source);
    if (!BRANCH.test(o.branch)) throw new Error(`Not a branch name: ${o.branch}`);
    if (source.kind === "path" && !existsSync(join(source.path, ".git"))) throw new Error(`No git repository at ${source.path}`);
    const projectDir = join(o.workspaceDir, o.projectId);
    await mkdir(projectDir, { recursive: true });
    const dir = await mkdtemp(join(projectDir, "detect-"));
    try {
        // A local path ignores --depth; file:// keeps the clone shallow.
        const from = source.kind === "url" ? source.url : pathToFileURL(source.path).href;
        await git(["clone", "--quiet", "--depth", "1", "--single-branch", "--branch", o.branch, "--", from, dir]).catch((e: Error) => {
            throw new Error(`Could not clone the branch "${o.branch}": ${e.message.trim().split("\n").pop()}`);
        });
        return await work(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/** The branch a repository's HEAD names, read without a clone; null when the source cannot be read. */
export async function defaultBranch(source: string): Promise<string | null> {
    const s = parseSource(source);
    const out = await git(["ls-remote", "--symref", "--", s.kind === "url" ? s.url : s.path, "HEAD"]).catch(() => null);
    const name = out?.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m)?.[1] ?? null;
    return name && BRANCH.test(name) ? name : null;
}

export async function deleteProjectClones(workspaceDir: string, projectId: string): Promise<void> {
    await rm(join(workspaceDir, projectId), { recursive: true, force: true });
}

import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

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
    await git(["clone", "--quiet", "--no-hardlinks", "--", source.kind === "url" ? source.url : source.path, tmp]);
    try {
        await git(["checkout", "--quiet", "-B", o.branch, `origin/${o.branch}`], tmp);
    } catch {
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
    if (existsSync(clonePath)) await rm(tmp, { recursive: true, force: true });
    else await rename(tmp, clonePath);
    return { sha, clonePath };
}

export async function deleteProjectClones(workspaceDir: string, projectId: string): Promise<void> {
    await rm(join(workspaceDir, projectId), { recursive: true, force: true });
}

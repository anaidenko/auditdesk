import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { type LineMap, type StripRules, commitPrepared, stripAnswers } from "./strip";

const run = promisify(execFile);
const git = async (args: string[], cwd?: string) => (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

/**
 * A fixture ready for an eval, under `<workspace>/evals/` (design § 11): the pinned commit's files
 * in a fresh repository, its answers removed, committed once with a fixed author and date, so the
 * prepared SHA is the same on every run. The run records it, since the prepared tree's files no
 * longer match the upstream commit's; the upstream clone keeps the original for the key.
 */
export async function prepareFixture(
    f: { name: string; url: string; sha: string; rules: StripRules },
    workspaceDir: string
): Promise<{ path: string; upstreamDir: string; upstreamSha: string; preparedSha: string; lineMap: LineMap; removedImports: string[] }> {
    const base = join(workspaceDir, "evals");
    await mkdir(base, { recursive: true });
    const upstream = join(base, `${f.name}-upstream`);
    // A partial clone fetches only the blobs of the pinned commit; a local path is copied whole.
    const remote = /^(https?|ssh|git):\/\/|^git@/.test(f.url);
    // A relative path is the caller's: the fetch below runs inside the cached clone.
    const url = remote ? f.url : resolve(f.url);
    if (!existsSync(upstream)) await git(["clone", "--quiet", ...(remote ? ["--filter=blob:none"] : []), "--no-checkout", url, upstream]);
    else await git(["remote", "set-url", "origin", url], upstream);
    const has = () =>
        git(["cat-file", "-e", `${f.sha}^{commit}`], upstream).then(
            () => true,
            () => false
        );
    if (!(await has()))
        await git(["fetch", "--quiet", ...(remote ? ["--filter=blob:none"] : []), "origin", f.sha], upstream).catch(() => {});
    if (!(await has())) throw new Error(`${f.url} has no commit ${f.sha}`);

    const path = join(base, `${f.name}-${f.sha.slice(0, 12)}`);
    await rm(path, { recursive: true, force: true });
    await mkdir(path);
    const tar = join(base, `${f.name}-${f.sha.slice(0, 12)}.tar`);
    await git(["archive", "--format=tar", "-o", tar, f.sha], upstream);
    await run("tar", ["-xf", tar, "-C", path]);
    await rm(tar);
    // Staged, not committed: the prepared commit is the repository's only one, so the answers are in
    // no history an audit's scanners read (gitleaks scans every commit). The originals' blobs that
    // staging wrote are pruned, or an audit's clone of this repository would copy them.
    await git(["init", "--quiet", "-b", "main"], path);
    await git(["add", "-A", "--force"], path);
    const { lineMap, removedImports } = await stripAnswers(path, f.rules);
    const preparedSha = await commitPrepared(path);
    await git(["prune", "--expire=now"], path);
    return { path, upstreamDir: upstream, upstreamSha: f.sha, preparedSha, lineMap, removedImports };
}

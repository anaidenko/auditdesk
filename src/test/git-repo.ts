import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { git } from "@/engine/git";

const ID = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];

async function write(root: string, files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
    }
}

/** A throwaway git repository with one commit on `main`, optional branches and uncommitted edits. */
export async function makeRepo(
    files: Record<string, string>,
    o: { uncommitted?: Record<string, string>; branches?: Record<string, Record<string, string>> } = {}
): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "auditdesk-repo-"));
    await git(["init", "-q", "-b", "main"], root);
    await write(root, files);
    await git(["add", "-A"], root);
    await git([...ID, "commit", "-q", "-m", "initial"], root);
    for (const [branch, branchFiles] of Object.entries(o.branches ?? {})) {
        await git(["checkout", "-q", "-b", branch], root);
        await write(root, branchFiles);
        await git(["add", "-A"], root);
        await git([...ID, "commit", "-q", "-m", branch], root);
        await git(["checkout", "-q", "main"], root);
    }
    await write(root, o.uncommitted ?? {});
    return root;
}

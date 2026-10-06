import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** An error the agent sees as its tool result; anything else is a bug and fails the run. */
export class ToolError extends Error {}

export const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "out", "coverage", "vendor", ".turbo", ".cache"]);

/**
 * Every file tool resolves its path here. A real path outside the clone (through `..` or a
 * symlink) could read another client's clone or the app's own `.env.local` (design § 8).
 */
export async function resolveInClone(root: string, path: string): Promise<{ abs: string; rel: string }> {
    if (path.includes("\0")) throw new ToolError("Invalid path.");
    if (isAbsolute(path)) throw new ToolError(`Use a path relative to the repository root, not ${path}.`);
    const rootReal = await realpath(root);
    let real: string;
    try {
        real = await realpath(resolve(rootReal, path));
    } catch {
        const lexical = relative(rootReal, resolve(rootReal, path));
        if (lexical.startsWith("..")) throw new ToolError(`The path ${path} leaves the repository.`);
        throw new ToolError(`No such file or directory: ${path}`);
    }
    const rel = relative(rootReal, real);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ToolError(`The path ${path} leaves the repository.`);
    if (rel === ".git" || rel.startsWith(`.git${sep}`)) throw new ToolError("The .git directory is not readable.");
    return { abs: real, rel: rel || "." };
}

export function globToRegExp(glob: string): RegExp {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*" && glob[i + 1] === "*") {
            re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
            i += glob[i + 2] === "/" ? 2 : 1;
        } else if (c === "*") re += "[^/]*";
        else if (c === "?") re += "[^/]";
        else if (c === "{") {
            const end = glob.indexOf("}", i);
            re += `(?:${glob
                .slice(i + 1, end)
                .split(",")
                .map(escape)
                .join("|")})`;
            i = end;
        } else re += escape(c);
    }
    // A glob without a slash matches the file name anywhere, as most tools do.
    return new RegExp(glob.includes("/") ? `^${re}$` : `(?:^|/)${re}$`);
}

function escape(s: string): string {
    return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Regular files and symlinks, relative to the root. Symlinks are listed, never followed. */
export async function* walk(root: string, dir = ""): AsyncGenerator<{ rel: string; size: number } | { rel: string; symlink: true }> {
    const entries = await readdir(join(root, dir), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isSymbolicLink()) yield { rel, symlink: true };
        else if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) yield* walk(root, rel);
        } else if (e.isFile()) yield { rel, size: (await lstat(join(root, rel))).size };
    }
}

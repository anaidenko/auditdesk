import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";

const run = promisify(execFile);

/** What a prepared fixture loses: the answers an agent could otherwise read (design § 11). */
export interface StripRules {
    /** Paths relative to the tree, deleted whole: one ending in "/" is a folder, one with "*" a pattern ("**" crosses folders). */
    deletePaths: string[];
    /** A statement starting on a matching line is removed through its closing parenthesis. */
    statementPatterns: RegExp[];
    /** A block starting on a matching line (an `if` that only scores a challenge) is removed through its closing brace. */
    blockPatterns?: RegExp[];
    /** A line holding only a challenge key (an entry of a list of them) is removed. */
    keyLine?: RegExp;
    /**
     * Where the fixture lists its challenge keys, read before the file is deleted. Every key is renamed
     * to an opaque token wherever it is left, and the prep fails if any key remains in any form.
     */
    keys?: { file: string; pattern: RegExp };
}

/** For each file, an original line number to its prepared one, or null when the line was removed. */
export type LineMap = Map<string, (line: number) => number | null>;

const MARKER = /vuln-code-snippet/;
const ONLY_MARKER = /^\s*(\/\/|#|<!--|\/\*)\s*vuln-code-snippet\b/;
const TRAILING_MARKER = /\s*(\/\/|#)\s*vuln-code-snippet\b[^\r\n]*/;
const SCRIPT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const RESOLVE = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"];

const git = async (args: string[], cwd: string, env: Record<string, string> = {}) =>
    (await run("git", args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

/** Brackets of one kind opened minus closed on a line, outside strings. */
function depth(line: string, open: string, close: string): number {
    let d = 0;
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
        } else if (c === "'" || c === '"' || c === "`") quote = c;
        else if (c === open) d++;
        else if (c === close) d--;
    }
    return d;
}

function globRegex(pattern: string): RegExp {
    const body = pattern
        .split(/(\*\*\/|\*)/)
        .map(part => (part === "**/" ? "(?:.*/)?" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
        .join("");
    return new RegExp(`^${body}$`);
}

/** The syntax errors TypeScript's parser finds in a script; it reads the text and runs nothing. */
function syntaxErrors(file: string, text: string): number {
    return ts.transpileModule(text, {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve }
    }).diagnostics!.length;
}

/** Which lines of one file survive, their text, and the deleted modules whose imports went with them. */
function strip(
    file: string,
    lines: string[],
    rules: StripRules,
    deleted: (path: string) => boolean
): { keep: boolean[]; text: string[]; imports: string[] } {
    const keep = lines.map(() => true);
    const text = [...lines];
    const imports: string[] = [];
    const removeThrough = (from: string, to: string, i: number): number => {
        let open = 0;
        let j = i;
        for (; j < lines.length; j++) {
            keep[j] = false;
            open += depth(lines[j], from, to);
            if (open <= 0) break;
        }
        return j;
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ONLY_MARKER.test(line) || rules.keyLine?.test(line)) {
            keep[i] = false;
            continue;
        }
        if (SCRIPT.test(file) && /^\s*import\b/.test(line) && !/^\s*import\s*\(/.test(line)) {
            let end = i;
            while (end < lines.length - 1 && !/from\s+['"]|^\s*import\s+['"]/.test(lines[end])) end++;
            const m = lines[end].match(/from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/);
            const spec = m?.[1] ?? m?.[2];
            if (spec?.startsWith(".")) {
                const base = normalize(join(dirname(file), spec));
                if (RESOLVE.some(ext => deleted(base + ext))) {
                    for (let j = i; j <= end; j++) keep[j] = false;
                    imports.push(`${file}: ${spec}`);
                    i = end;
                    continue;
                }
            }
        }
        if (rules.statementPatterns.some(p => p.test(line))) {
            i = removeThrough("(", ")", i);
            continue;
        }
        if (rules.blockPatterns?.some(p => p.test(line))) {
            i = removeThrough("{", "}", i);
            continue;
        }
        if (MARKER.test(line)) text[i] = line.replace(TRAILING_MARKER, "");
    }
    return { keep, text, imports };
}

/** Each key and its capitalised form (inside identifiers such as `verifyLocalXssChallenge`) to one opaque token. */
function renamer(keys: string[]): (line: string) => string {
    if (!keys.length) return line => line;
    const to = new Map<string, string>();
    for (const key of keys) {
        const token = `ch${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
        to.set(key, token);
        to.set(key[0].toUpperCase() + key.slice(1), `C${token.slice(1)}`);
    }
    const any = new RegExp(
        [...to.keys()]
            .sort((a, b) => b.length - a.length)
            .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|"),
        "g"
    );
    return line => line.replace(any, k => to.get(k)!);
}

/**
 * Prepares a checked-out fixture in place: deletes the answer paths, strips the markers and the
 * statements and blocks that hold answers, removes imports of what was deleted, and renames the
 * challenge keys, in every other tracked text file. It refuses to finish when a key survives or a
 * script no longer parses. Returns how lines moved, so a key read from the upstream markers can be
 * written in the prepared tree's line numbers, and the imports it removed, which the eval reports.
 */
export async function stripAnswers(tree: string, rules: StripRules): Promise<{ lineMap: LineMap; removedImports: string[] }> {
    const files = (await git(["ls-files", "-z"], tree)).split("\0").filter(Boolean);
    const patterns = rules.deletePaths.filter(p => p.includes("*")).map(globRegex);
    const deleted = (f: string) =>
        rules.deletePaths.some(p => (p.endsWith("/") ? f.startsWith(p) : f === p)) || patterns.some(r => r.test(f));
    const keys = rules.keys ? [...(await readFile(join(tree, rules.keys.file), "utf8")).matchAll(rules.keys.pattern)].map(m => m[1]) : [];
    const rename = renamer(keys);

    const lineMap: LineMap = new Map();
    const removedImports: string[] = [];
    const broken: string[] = [];
    const kept: string[] = [];
    for (const f of files) {
        if (deleted(f)) {
            lineMap.set(f, () => null);
            continue;
        }
        // A tracked symbolic link is left as it is: writing through it would change a file outside the tree.
        if ((await lstat(join(tree, f))).isSymbolicLink()) continue;
        const buf = await readFile(join(tree, f));
        if (buf.includes(0)) continue;
        kept.push(f);
        const original = buf.toString("utf8");
        const lines = original.split("\n");
        const { keep, text, imports } = strip(f, lines, rules, deleted);
        removedImports.push(...imports);
        const prepared = text.map(rename);
        if (keep.every(Boolean) && prepared.every((t, i) => t === lines[i])) continue;
        const moved: (number | null)[] = [];
        let n = 0;
        for (const k of keep) moved.push(k ? ++n : null);
        lineMap.set(f, line => moved[line - 1] ?? null);
        const result = prepared.filter((_, i) => keep[i]).join("\n");
        if (SCRIPT.test(f) && syntaxErrors(f, result) > syntaxErrors(f, original)) broken.push(f);
        await writeFile(join(tree, f), result);
    }
    for (const f of files) if (deleted(f)) await rm(join(tree, f), { force: true });
    for (const p of rules.deletePaths) if (p.endsWith("/")) await rm(join(tree, p), { recursive: true, force: true });
    if (broken.length) throw new Error(`The prep broke the syntax of ${broken.join(", ")}`);

    if (keys.length) {
        const lower = keys.map(k => k.toLowerCase());
        const left: string[] = [];
        for (const f of kept) {
            (await readFile(join(tree, f), "utf8")).split("\n").forEach((line, i) => {
                const l = line.toLowerCase();
                if (lower.some(k => l.includes(k))) left.push(`${f}:${i + 1}`);
            });
        }
        if (left.length) throw new Error(`A challenge key is left at ${left.slice(0, 20).join(", ")}${left.length > 20 ? ", …" : ""}`);
    }
    return { lineMap, removedImports };
}

/** Commits the prepared tree with a fixed author and date: the same tree and parent (none, for a fixture) always give one SHA. */
export async function commitPrepared(tree: string): Promise<string> {
    const when = "2026-01-01T00:00:00Z";
    const env = {
        GIT_AUTHOR_NAME: "Auditdesk",
        GIT_AUTHOR_EMAIL: "eval@auditdesk.invalid",
        GIT_COMMITTER_NAME: "Auditdesk",
        GIT_COMMITTER_EMAIL: "eval@auditdesk.invalid",
        GIT_AUTHOR_DATE: when,
        GIT_COMMITTER_DATE: when
    };
    // --force: the fixture's own .gitignore must not drop a file it tracks.
    await git(["add", "-A", "--force"], tree);
    await git(
        ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "Prepared for an Auditdesk eval: answers removed"],
        tree,
        env
    );
    return git(["rev-parse", "HEAD"], tree);
}

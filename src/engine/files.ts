import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Script, createContext } from "node:vm";

import { ToolError, globToRegExp, resolveInClone, walk } from "./paths";

export const LIMITS = {
    listEntries: 1000,
    readLines: 400,
    lineChars: 2000,
    grepMatches: 200,
    grepLineChars: 300,
    grepFileBytes: 1_000_000,
    grepFileMs: 2000,
    grepTotalMs: 10_000
};

// The pattern comes from the model, and the app is one process: a regex that backtracks without
// end would block every page and the runner. A vm timeout interrupts it; no time limit exists
// on RegExp itself.
const MATCH_LINES = new Script("hits = []; for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);");

function isBinary(buf: Buffer): boolean {
    return buf.subarray(0, 8000).includes(0);
}

export async function listFiles(root: string, o: { dir?: string; glob?: string; limit?: number } = {}): Promise<string> {
    let base = "";
    if (o.dir && o.dir !== ".") {
        const { abs, rel } = await resolveInClone(root, o.dir);
        if (!(await stat(abs)).isDirectory()) throw new ToolError(`${rel} is a file; use read_file.`);
        base = rel;
    }
    const match = o.glob ? globToRegExp(o.glob) : null;
    const limit = o.limit ?? LIMITS.listEntries;
    const lines: string[] = [];
    let more = 0;
    for await (const entry of walk(join(root, base))) {
        const rel = base ? `${base}/${entry.rel}` : entry.rel;
        if (match && !match.test(rel)) continue;
        if (lines.length >= limit) {
            more++;
            continue;
        }
        lines.push("symlink" in entry ? `${rel} -> symlink, not followed` : `${rel} (${entry.size} bytes)`);
    }
    if (more) lines.push(`… ${more} more files not shown; narrow with dir or glob.`);
    return lines.join("\n") || "No files.";
}

/** Masks each whole line before anything cuts it: a secret split by a cut would no longer match its value. */
export type LineMask = (line: string) => string;

export async function readFileRange(root: string, path: string, startLine: number, endLine: number, mask?: LineMask): Promise<string> {
    const { abs, rel } = await resolveInClone(root, path);
    const buf = await readFile(abs).catch(() => {
        throw new ToolError(`${path} is a directory or unreadable; use list_files.`);
    });
    if (isBinary(buf)) throw new ToolError(`${rel} is a binary file.`);
    const all = buf.toString("utf8").split(/\r?\n/);
    const start = Math.max(1, Math.min(startLine, all.length));
    const end = Math.min(all.length, Math.max(start, endLine), start + LIMITS.readLines - 1);
    const body = all.slice(start - 1, end).map((raw, i) => `${start + i}| ${cap(mask ? mask(raw) : raw)}`);
    return [`${rel}, lines ${start}-${end} of ${all.length}`, ...body].join("\n");
}

function cap(line: string): string {
    return line.length > LIMITS.lineChars ? `${line.slice(0, LIMITS.lineChars)} … [line cut: ${line.length} characters]` : line;
}

export const SNIPPET_LINES = 30;

/** The evidence a finding carries: at most 30 lines, each masked whole and then capped like read_file's. */
export function snippetOf(lines: string[], startLine: number, endLine: number, mask?: LineMask): string {
    return lines
        .slice(startLine - 1, Math.min(endLine, startLine + SNIPPET_LINES - 1))
        .map(raw => cap(mask ? mask(raw) : raw))
        .join("\n");
}

/** A snippet read from the clone, or null when the file cannot be read there. */
export async function readSnippet(root: string, path: string, startLine: number, endLine: number, mask?: LineMask): Promise<string | null> {
    try {
        const { abs } = await resolveInClone(root, path);
        return snippetOf((await readFile(abs, "utf8")).split(/\r?\n/), startLine, endLine, mask);
    } catch {
        return null;
    }
}

export async function grepFiles(
    root: string,
    pattern: string,
    o: { glob?: string; timeoutMs?: number; totalMs?: number; mask?: LineMask } = {}
): Promise<string> {
    let re: RegExp;
    try {
        re = new RegExp(pattern);
    } catch (e) {
        throw new ToolError(`Invalid regular expression: ${(e as Error).message}`);
    }
    const match = o.glob ? globToRegExp(o.glob) : null;
    const sandbox = createContext({ re, lines: [] as string[], hits: [] as number[] });
    const deadline = Date.now() + (o.totalMs ?? LIMITS.grepTotalMs);
    const hits: string[] = [];
    let tooBig = 0;
    let more = 0;
    for await (const entry of walk(root)) {
        if ("symlink" in entry || (match && !match.test(entry.rel))) continue;
        if (entry.size > LIMITS.grepFileBytes) {
            tooBig++;
            continue;
        }
        const buf = await readFile(join(root, entry.rel));
        if (isBinary(buf)) continue;
        const raw = buf.toString("utf8").split(/\r?\n/);
        const lines = o.mask ? raw.map(o.mask) : raw;
        sandbox.lines = lines;
        try {
            const left = deadline - Date.now();
            if (left <= 0) throw Object.assign(new Error("deadline"), { code: "ERR_SCRIPT_EXECUTION_TIMEOUT" });
            MATCH_LINES.runInContext(sandbox, { timeout: Math.min(o.timeoutMs ?? LIMITS.grepFileMs, left) });
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw e;
            throw new ToolError(`The pattern took too long on ${entry.rel}; simplify it (nested quantifiers such as (a+)+ backtrack).`);
        }
        for (const i of sandbox.hits as number[]) {
            if (hits.length >= LIMITS.grepMatches) more++;
            else hits.push(`${entry.rel}:${i + 1}: ${lines[i].trim().slice(0, LIMITS.grepLineChars)}`);
        }
    }
    if (more) hits.push(`… ${more} more matches not shown; narrow the pattern or glob.`);
    if (tooBig) hits.push(`(${tooBig} file${tooBig > 1 ? "s" : ""} over ${LIMITS.grepFileBytes} bytes skipped; read them in ranges)`);
    return hits.join("\n") || "No matches.";
}

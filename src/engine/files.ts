import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ToolError, globToRegExp, resolveInClone, walk } from "./paths";

export const LIMITS = {
    listEntries: 1000,
    readLines: 400,
    lineChars: 2000,
    grepMatches: 200,
    grepLineChars: 300,
    grepFileBytes: 1_000_000
};

function isBinary(buf: Buffer): boolean {
    return buf.subarray(0, 8000).includes(0);
}

export async function listFiles(root: string, o: { dir?: string; glob?: string; limit?: number } = {}): Promise<string> {
    const base = o.dir && o.dir !== "." ? (await resolveInClone(root, o.dir)).rel : "";
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

export async function readFileRange(root: string, path: string, startLine: number, endLine: number): Promise<string> {
    const { abs, rel } = await resolveInClone(root, path);
    const buf = await readFile(abs).catch(() => {
        throw new ToolError(`${path} is a directory or unreadable; use list_files.`);
    });
    if (isBinary(buf)) throw new ToolError(`${rel} is a binary file.`);
    const all = buf.toString("utf8").split(/\r?\n/);
    const start = Math.max(1, Math.min(startLine, all.length));
    const end = Math.min(all.length, Math.max(start, endLine), start + LIMITS.readLines - 1);
    const body = all.slice(start - 1, end).map((line, i) => {
        const shown = line.length > LIMITS.lineChars ? `${line.slice(0, LIMITS.lineChars)} … [line cut: ${line.length} characters]` : line;
        return `${start + i}| ${shown}`;
    });
    return [`${rel}, lines ${start}-${end} of ${all.length}`, ...body].join("\n");
}

export async function grepFiles(root: string, pattern: string, o: { glob?: string } = {}): Promise<string> {
    let re: RegExp;
    try {
        re = new RegExp(pattern);
    } catch (e) {
        throw new ToolError(`Invalid regular expression: ${(e as Error).message}`);
    }
    const match = o.glob ? globToRegExp(o.glob) : null;
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
        const lines = buf.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (!re.test(lines[i])) continue;
            if (hits.length >= LIMITS.grepMatches) more++;
            else hits.push(`${entry.rel}:${i + 1}: ${lines[i].trim().slice(0, LIMITS.grepLineChars)}`);
        }
    }
    if (more) hits.push(`… ${more} more matches not shown; narrow the pattern or glob.`);
    if (tooBig) hits.push(`(${tooBig} file${tooBig > 1 ? "s" : ""} over ${LIMITS.grepFileBytes} bytes skipped; read them in ranges)`);
    return hits.join("\n") || "No matches.";
}

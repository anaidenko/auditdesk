import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** What a prepared fixture loses: the answers an agent could otherwise read (design § 11). */
export interface StripRules {
    /** Paths relative to the tree, deleted whole; one ending in "/" is a folder. */
    deletePaths: string[];
    /** A statement starting on a matching line is removed through its closing parenthesis. */
    statementPatterns: RegExp[];
    /** A line holding only a challenge key (an entry of a list of them) is removed. */
    keyLine?: RegExp;
}

/** For each file, an original line number to its prepared one, or null when the line was removed. */
export type LineMap = Map<string, (line: number) => number | null>;

const MARKER = /vuln-code-snippet/;
const ONLY_MARKER = /^\s*(\/\/|#|<!--|\/\*)\s*vuln-code-snippet\b/;
const TRAILING_MARKER = /\s*(\/\/|#)\s*vuln-code-snippet\b.*$/;

const git = async (args: string[], cwd: string, env: Record<string, string> = {}) =>
    (await run("git", args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

/** Parentheses opened minus closed on a line, outside strings: enough for statements on their own lines. */
function depth(line: string): number {
    let d = 0;
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
        } else if (c === "'" || c === '"' || c === "`") quote = c;
        else if (c === "(") d++;
        else if (c === ")") d--;
    }
    return d;
}

/** Which lines of one file survive, and their text. */
function strip(lines: string[], rules: StripRules): { keep: boolean[]; text: string[] } {
    const keep = lines.map(() => true);
    const text = [...lines];
    let hidden = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/vuln-code-snippet hide-start/.test(line)) hidden = true;
        if (hidden) {
            keep[i] = false;
            if (/vuln-code-snippet hide-end/.test(line)) hidden = false;
            continue;
        }
        if (/vuln-code-snippet hide-line/.test(line) || ONLY_MARKER.test(line) || rules.keyLine?.test(line)) {
            keep[i] = false;
            continue;
        }
        if (rules.statementPatterns.some(p => p.test(line))) {
            let open = 0;
            let j = i;
            for (; j < lines.length; j++) {
                keep[j] = false;
                open += depth(lines[j]);
                if (open <= 0) break;
            }
            i = j;
            continue;
        }
        if (MARKER.test(line)) text[i] = line.replace(TRAILING_MARKER, "");
    }
    return { keep, text };
}

/**
 * Prepares a checked-out fixture in place: deletes the answer paths and strips the markers and the
 * statements that hold answers from every other tracked text file. Returns how lines moved, so a
 * key read from the upstream markers can be written in the prepared tree's line numbers.
 */
export async function stripAnswers(tree: string, rules: StripRules): Promise<LineMap> {
    const files = (await git(["ls-files", "-z"], tree)).split("\0").filter(Boolean);
    const map: LineMap = new Map();
    const gone = (f: string) => rules.deletePaths.some(p => (p.endsWith("/") ? f.startsWith(p) : f === p));
    for (const f of files) {
        if (gone(f)) {
            map.set(f, () => null);
            continue;
        }
        const buf = await readFile(join(tree, f));
        if (buf.includes(0)) continue;
        const lines = buf.toString("utf8").split("\n");
        const { keep, text } = strip(lines, rules);
        if (keep.every(Boolean) && text.every((t, i) => t === lines[i])) continue;
        const moved: (number | null)[] = [];
        let n = 0;
        for (const k of keep) moved.push(k ? ++n : null);
        map.set(f, line => moved[line - 1] ?? null);
        await writeFile(join(tree, f), text.filter((_, i) => keep[i]).join("\n"));
    }
    for (const p of rules.deletePaths) await rm(join(tree, p), { recursive: true, force: true });
    return map;
}

/** Commits the prepared tree with a fixed author and date: one parent and one tree always give one SHA. */
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
    await git(["add", "-A"], tree);
    await git(
        ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "Prepared for an Auditdesk eval: answers removed"],
        tree,
        env
    );
    return git(["rev-parse", "HEAD"], tree);
}

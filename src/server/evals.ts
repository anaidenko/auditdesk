import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import "server-only";

import { type EvalRow, parseEvalResult, parseVerdicts } from "@/engine/eval-results";

/** Where `pnpm eval` writes its results; AUDITDESK_EVAL_RESULTS points elsewhere for the tests. */
export function evalResultsDir(): string {
    return process.env.AUDITDESK_EVAL_RESULTS || join(process.cwd(), "evals/results");
}

/** A result row with its judge verdicts and how many of them Andrii has spot-checked. */
export type EvalHistoryRow = EvalRow & { judged: number; checked: number; agreed: number };

/**
 * Every eval result in the folder, newest first, and the Markdown files that could not be read as
 * one, so a result in an older format or a stray entry is named instead of dropped. A missing
 * folder is no results; one that cannot be read is an error.
 */
export async function loadEvalRows(): Promise<{ rows: EvalHistoryRow[]; skipped: string[] }> {
    const dir = evalResultsDir();
    let files: string[];
    try {
        files = await readdir(dir);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return { rows: [], skipped: [] };
        throw e;
    }
    const read = await Promise.all(
        files
            .filter(f => f.endsWith(".md"))
            .sort()
            .map(async (f): Promise<{ f: string; row: EvalHistoryRow | null }> => {
                const md = await readFile(join(dir, f), "utf8").catch(() => "");
                const row = parseEvalResult(md, f);
                if (!row) return { f, row: null };
                const verdicts = parseVerdicts(md).map(v => v.label);
                const checks = await loadChecks(f).catch(() => ({}) as Record<string, SpotCheck>);
                const checked = verdicts.filter(l => checks[l]);
                return {
                    f,
                    row: { ...row, judged: verdicts.length, checked: checked.length, agreed: checked.filter(l => checks[l].agree).length }
                };
            })
    );
    return {
        rows: read.flatMap(r => (r.row ? [r.row] : [])).sort((a, b) => b.date.localeCompare(a.date)),
        skipped: read.filter(r => !r.row).map(r => r.f)
    };
}

export interface SpotCheck {
    agree: boolean;
    note: string;
    at: string;
}

/** A result file in the results folder, by its bare name; anything else is refused. */
async function resultFile(file: string): Promise<string> {
    const path = join(evalResultsDir(), file);
    if (!/^[\w.+-]+\.md$/.test(file) || !(await stat(path).catch(() => null))?.isFile()) throw new Error(`Not a result file: ${file}`);
    return path;
}

const checksPath = (path: string) => path.replace(/\.md$/, ".review.json");

/** Andrii's calls on a result's judged findings, kept beside it as <result>.review.json. */
export async function loadChecks(file: string): Promise<Record<string, SpotCheck>> {
    const raw = await readFile(checksPath(await resultFile(file)), "utf8").catch(() => "{}");
    return JSON.parse(raw) as Record<string, SpotCheck>;
}

export async function saveCheck(file: string, label: string, check: { agree: boolean; note: string }): Promise<void> {
    const path = await resultFile(file);
    if (!/^F-\d+$/.test(label)) throw new Error(`Not a finding label: ${label}`);
    const checks = await loadChecks(file);
    checks[label] = { agree: check.agree, note: check.note.trim().slice(0, 500), at: new Date().toISOString() };
    await writeFile(checksPath(path), `${JSON.stringify(checks, null, 2)}\n`);
}

/** A result file's text; throws for a name that is not one. */
export async function loadResultText(file: string): Promise<string> {
    return readFile(await resultFile(file), "utf8");
}

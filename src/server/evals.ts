import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import "server-only";
import { z } from "zod";

import { type EvalRow, type JudgedFinding, parseEvalResult, parseVerdicts } from "@/engine/eval-results";

/** Where `pnpm eval` writes its results; AUDITDESK_EVAL_RESULTS points elsewhere for the tests. */
export function evalResultsDir(): string {
    return process.env.AUDITDESK_EVAL_RESULTS || join(process.cwd(), "evals/results");
}

/**
 * A result row with its judge's verdicts: how many Andrii can check, how many he has checked and
 * agreed with, how many the judge did not reach, and how many no line could be read for.
 */
export type EvalHistoryRow = EvalRow & { judged: number; checked: number; agreed: number; notJudged: number; unreadable: number };

export const SpotCheckSchema = z.object({
    agree: z.boolean(),
    note: z.string(),
    at: z.string(),
    /** The verdict and title checked: a check counts only while the result still says the same. */
    verdict: z.string().optional(),
    title: z.string().optional()
});
export type SpotCheck = z.infer<typeof SpotCheckSchema>;
const ChecksSchema = z.record(z.string().regex(/^F-\d+$/), SpotCheckSchema);

/** The check that still applies to a verdict: given to the same verdict on the same finding. */
export function currentCheck(checks: Record<string, SpotCheck>, v: JudgedFinding): SpotCheck | null {
    const c = checks[v.label];
    return c && (c.verdict === undefined || (c.verdict === v.verdict && c.title === v.title)) ? c : null;
}

/**
 * Every eval result in the folder, newest first; the Markdown files that could not be read as one,
 * so a result in an older format or a stray entry is named instead of dropped; and the review files
 * that could not be read. A missing folder is no results; one that cannot be read is an error.
 */
export async function loadEvalRows(): Promise<{ rows: EvalHistoryRow[]; skipped: string[]; brokenReviews: string[] }> {
    const dir = evalResultsDir();
    let files: string[];
    try {
        files = await readdir(dir);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return { rows: [], skipped: [], brokenReviews: [] };
        throw e;
    }
    const brokenReviews: string[] = [];
    const read = await Promise.all(
        files
            .filter(f => f.endsWith(".md"))
            .sort()
            .map(async (f): Promise<{ f: string; row: EvalHistoryRow | null }> => {
                const md = await readFile(join(dir, f), "utf8").catch(() => "");
                const row = parseEvalResult(md, f);
                if (!row) return { f, row: null };
                const { verdicts, notJudged, unreadable } = parseVerdicts(md);
                const checks = await loadChecks(f).catch(() => {
                    brokenReviews.push(reviewName(f));
                    return {};
                });
                const checked = verdicts.map(v => currentCheck(checks, v)).filter((c): c is SpotCheck => !!c);
                return {
                    f,
                    row: {
                        ...row,
                        judged: verdicts.length,
                        checked: checked.length,
                        agreed: checked.filter(c => c.agree).length,
                        notJudged: notJudged.length,
                        unreadable
                    }
                };
            })
    );
    return {
        rows: read.flatMap(r => (r.row ? [r.row] : [])).sort((a, b) => b.date.localeCompare(a.date)),
        skipped: read.filter(r => !r.row).map(r => r.f),
        brokenReviews: brokenReviews.sort()
    };
}

/** A result file in the results folder, by its bare name; anything else is refused. */
async function resultFile(file: string): Promise<string> {
    const path = join(evalResultsDir(), file);
    if (!/^[\w.+-]+\.md$/.test(file) || !(await stat(path).catch(() => null))?.isFile()) throw new Error(`Not a result file: ${file}`);
    return path;
}

const reviewName = (file: string) => file.replace(/\.md$/, ".review.json");

/** Andrii's calls on a result's judged findings, kept beside it as <result>.review.json. */
export async function loadChecks(file: string): Promise<Record<string, SpotCheck>> {
    const path = join(evalResultsDir(), reviewName(file));
    await resultFile(file);
    const raw = await readFile(path, "utf8").catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return "{}";
        throw e;
    });
    try {
        return ChecksSchema.parse(JSON.parse(raw));
    } catch {
        throw new Error(`${reviewName(file)} cannot be read: fix or remove it, it is not overwritten.`);
    }
}

// Saves of one file run one after another: each reads the file the previous one wrote.
const queues = new Map<string, Promise<unknown>>();

export async function saveCheck(file: string, label: string, check: { agree: boolean; note: string }): Promise<void> {
    if (!/^F-\d+$/.test(label)) throw new Error(`Not a finding label: ${label}`);
    const md = await readFile(await resultFile(file), "utf8");
    if (!parseEvalResult(md, file)) throw new Error(`${file} is not an eval result.`);
    const v = parseVerdicts(md).verdicts.find(x => x.label === label);
    if (!v) throw new Error(`${label} has no judge verdict to check in ${file}.`);
    const path = join(evalResultsDir(), reviewName(file));
    const save = async () => {
        const checks = await loadChecks(file);
        checks[label] = {
            agree: check.agree,
            note: check.note.trim().slice(0, 500),
            at: new Date().toISOString(),
            verdict: v.verdict,
            title: v.title
        };
        // A reader never sees a half-written file: the new one replaces it whole.
        await writeFile(`${path}.tmp`, `${JSON.stringify(checks, null, 2)}\n`);
        await rename(`${path}.tmp`, path);
    };
    const next = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(save);
    queues.set(path, next);
    await next.finally(() => queues.get(path) === next && queues.delete(path));
}

/** A result file's text; throws for a name that is not one. */
export async function loadResultText(file: string): Promise<string> {
    return readFile(await resultFile(file), "utf8");
}

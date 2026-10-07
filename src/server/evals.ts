import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import "server-only";

import { type EvalRow, parseEvalResult } from "@/engine/eval-results";

/** Where `pnpm eval` writes its results; AUDITDESK_EVAL_RESULTS points elsewhere for the tests. */
export function evalResultsDir(): string {
    return process.env.AUDITDESK_EVAL_RESULTS || join(process.cwd(), "evals/results");
}

/**
 * Every eval result in the folder, newest first, and the Markdown files that could not be read as
 * one, so a result in an older format or a stray entry is named instead of dropped. A missing
 * folder is no results; one that cannot be read is an error.
 */
export async function loadEvalRows(): Promise<{ rows: EvalRow[]; skipped: string[] }> {
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
            .map(async f => ({ f, row: parseEvalResult(await readFile(join(dir, f), "utf8").catch(() => ""), f) }))
    );
    return {
        rows: read.flatMap(r => (r.row ? [r.row] : [])).sort((a, b) => b.date.localeCompare(a.date)),
        skipped: read.filter(r => !r.row).map(r => r.f)
    };
}

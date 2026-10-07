import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import "server-only";

import { type EvalRow, parseEvalResult } from "@/engine/eval-results";

/** Where `pnpm eval` writes its results; AUDITDESK_EVAL_RESULTS points elsewhere for the tests. */
export function evalResultsDir(): string {
    return process.env.AUDITDESK_EVAL_RESULTS || join(process.cwd(), "evals/results");
}

/** Every eval result in the folder, newest first. */
export async function loadEvalRows(): Promise<EvalRow[]> {
    const dir = evalResultsDir();
    const files = await readdir(dir).catch(() => [] as string[]);
    const rows = await Promise.all(
        files.filter(f => f.endsWith(".md")).map(async f => parseEvalResult(await readFile(join(dir, f), "utf8"), f))
    );
    return rows.filter((r): r is EvalRow => r !== null).sort((a, b) => b.date.localeCompare(a.date));
}

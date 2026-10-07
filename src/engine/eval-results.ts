import type { ModelAccess } from "./types";

/** One `pnpm eval` result, read back from the Markdown file it wrote (evals/summary.ts). */
export interface EvalRow {
    file: string;
    fixture: string;
    model: string;
    effort: string;
    date: string;
    aspects: string[];
    access: ModelAccess;
    found: number;
    total: number;
    agentsFound: number;
    /** Only for a fixture whose key lists every planted defect. */
    falseFindings: number | null;
    usd: number;
    judgeUsd: number | null;
    durationSec: number;
    commit: string | null;
    dirty: boolean;
    aborted: boolean;
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s.replace(/,/g, "")));

/**
 * Parses a result file's header and totals; null for a file that is not one. The format is ours,
 * so the history page reads every result, older ones included, without a second file per run.
 */
export function parseEvalResult(md: string, file: string): EvalRow | null {
    const title = md.match(/^# Eval: (\S+), (\S+) at (\S+)$/m);
    const recall = md.match(/^\*\*(\d+) of (\d+)\*\* key entries found \(\d+%\)(?:; agents alone: (\d+) of \d+)?/m);
    if (!title || !recall) return null;
    const duration = md.match(/\*\*Duration:\*\* (?:(\d+) min )?(\d+) s;/);
    const auditdesk = md.match(/\*\*Auditdesk:\*\* `([0-9a-f]{7,40})`(, with uncommitted changes)?/);
    return {
        file,
        fixture: title[1],
        model: title[2],
        effort: title[3],
        date: md.match(/\*\*Date:\*\* (\S+)/)?.[1] ?? "",
        aspects: (md.match(/\*\*Aspects:\*\* (.+)$/m)?.[1] ?? "").split(", ").filter(Boolean),
        access: /\*\*Access:\*\* API key/.test(md) ? "api_key" : "claude_plan",
        found: Number(recall[1]),
        total: Number(recall[2]),
        agentsFound: Number(recall[3] ?? 0),
        falseFindings: num(md.match(/^\*\*False findings: (\d+)\*\*/m)?.[1]),
        usd: num(md.match(/^Agents: \$(\d[\d,]*(?:\.\d+)?)/m)?.[1]) ?? 0,
        judgeUsd: num(md.match(/^Judge: .*Cost \$(\d[\d,]*(?:\.\d+)?)/m)?.[1]),
        durationSec: duration ? Number(duration[1] ?? 0) * 60 + Number(duration[2]) : 0,
        commit: auditdesk?.[1] ?? null,
        dirty: !!auditdesk?.[2],
        aborted: /^- \*\*Aborted:\*\*/m.test(md)
    };
}

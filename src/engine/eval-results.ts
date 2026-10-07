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
    /** The count is the judge's verdicts; otherwise the grade's leftovers, with `beside` unresolved apart. */
    falseByJudge: boolean;
    /** Findings beside a key entry under another item, which the grade alone leaves unresolved. */
    beside: number | null;
    usd: number;
    /** Some calls had no price, so `usd` is a lower bound. */
    unpriced: boolean;
    judgeUsd: number | null;
    judgeUnpriced: boolean;
    durationSec: number;
    commit: string | null;
    dirty: boolean;
    /** The key's digest: recall under two digests counts against different keys. */
    keyDigest: string | null;
    /** Why the audit stopped with an error, its first line; null when it ran through. */
    aborted: string | null;
    /** "aspect: status" for each agent that did not end done or declined. */
    incomplete: string[];
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s.replace(/,/g, "")));
const MONEY = String.raw`\$(\d[\d,]*(?:\.\d+)?)`;

/** The text under `## <title>` up to the next section. */
function section(md: string, title: string): string {
    const start = md.indexOf(`\n## ${title}\n`);
    if (start < 0) return "";
    const end = md.indexOf("\n## ", start + 1);
    return md.slice(start, end < 0 ? undefined : end);
}

/**
 * Parses a result file's header and totals; null for a file that is not one. The format is ours,
 * so the history page reads every result, older ones included, without a second file per run.
 * Each value is read from its own section, so a finding's title or a judge's reason, quoted in
 * the findings section, cannot pass for one.
 */
export function parseEvalResult(md: string, file: string): EvalRow | null {
    md = md.replace(/\r\n/g, "\n");
    const head = md.slice(0, md.indexOf("\n## ") < 0 ? undefined : md.indexOf("\n## "));
    const title = head.match(/^# Eval: (\S+), (\S+) at (\S+)$/m);
    const recall = section(md, "Recall").match(/^\*\*(\d+) of (\d+)\*\* key entries found \(\d+%\)(?:; agents alone: (\d+) of \d+)?/m);
    if (!title || !recall) return null;
    const duration = head.match(/\*\*Duration:\*\* (?:(\d+) min )?(\d+) s;/);
    const auditdesk = head.match(/\*\*Auditdesk:\*\* `([0-9a-f]{7,40})`(, with uncommitted changes)?(?:; key digest `([0-9a-f]+)`)?/);
    const outside = section(md, "Findings outside the key");
    const verdictLine = outside.match(/^## Findings outside the key\n\n(.*)$/m)?.[1] ?? "";
    // The judge's line follows the last line the writer puts after the quoted findings.
    const tail = outside.slice(outside.lastIndexOf("\nQuestions outside the key: "));
    const judge = tail.match(new RegExp(`^Judge: .*Cost ${MONEY}(, at least)?`, "m"));
    const agents = section(md, "Cost").match(new RegExp(`^Agents: ${MONEY}(, at least)?`, "m"));
    const falseCount = verdictLine.match(/^\*\*False findings: (\d+)\*\*( by the judge's verdicts)?(?:, and (\d+) filed beside)?/);
    return {
        file,
        fixture: title[1],
        model: title[2],
        effort: title[3],
        date: head.match(/\*\*Date:\*\* (\S+)/)?.[1] ?? "",
        aspects: (head.match(/\*\*Aspects:\*\* (.+)$/m)?.[1] ?? "").split(", ").filter(Boolean),
        access: /\*\*Access:\*\* API key/.test(head) ? "api_key" : "claude_plan",
        found: Number(recall[1]),
        total: Number(recall[2]),
        agentsFound: Number(recall[3] ?? 0),
        falseFindings: num(falseCount?.[1]),
        falseByJudge: !!falseCount?.[2],
        beside: num(falseCount?.[3]),
        usd: num(agents?.[1]) ?? 0,
        unpriced: !!agents?.[2],
        judgeUsd: num(judge?.[1]),
        judgeUnpriced: !!judge?.[2],
        durationSec: duration ? Number(duration[1] ?? 0) * 60 + Number(duration[2]) : 0,
        commit: auditdesk?.[1] ?? null,
        dirty: !!auditdesk?.[2],
        keyDigest: auditdesk?.[3] ?? null,
        aborted: head.match(/^- \*\*Aborted:\*\* (.*)$/m)?.[1] ?? null,
        incomplete: [...section(md, "Agents").matchAll(/^\| (\S+) \| (partial|stopped|failed|not started) \|/gm)].map(
            m => `${m[1]}: ${m[2]}`
        )
    };
}

/** A judge's verdict on one finding outside the key, as the result file lists it. */
export interface JudgedFinding {
    label: string;
    item: string;
    where: string;
    title: string;
    verdict: string;
    key: string | null;
    reason: string;
}

/**
 * The reasons evals/judge.ts gives a verdict it did not reach, written there and recognised here:
 * the spot-check lists them apart, with nothing to agree with.
 */
export const NOT_JUDGED = {
    stopped: (why: string) => `Not judged: the judge stopped (${why}).`,
    cap: "Not judged: the judge's cap was reached.",
    declined: "Not judged: the judge declined to answer.",
    unknownEntry: (id: string | null) => `Not judged: the judge named an entry the key does not have: ${id}.`,
    schema: "Not judged: the judge's answer did not match the verdict schema."
};

/**
 * The judged findings of a result file, for Andrii's spot-check: the verdicts to check, those the
 * judge did not reach, and how many of the judge's tally no line could be read for. A leftover the
 * judge never read carries no verdict and is left out.
 */
export function parseVerdicts(md: string): { verdicts: JudgedFinding[]; notJudged: JudgedFinding[]; unreadable: number } {
    md = md.replace(/\r\n/g, "\n");
    const outside = section(md, "Findings outside the key");
    const line = /^- (F-\d+) \(([^,]+), (.+?)\): (.*?) — judge: (\w+)(?: (\S+))?; (.*)$/;
    const all = outside.split("\n").flatMap(l => {
        const m = l.match(line);
        return m ? [{ label: m[1], item: m[2], where: m[3], title: m[4], verdict: m[5], key: m[6] ?? null, reason: m[7] }] : [];
    });
    const tail = outside.slice(outside.lastIndexOf("\nQuestions outside the key: "));
    const tally = Number(tail.match(/^Judge: (\d+) verdicts?:/m)?.[1] ?? all.length);
    const notJudged = all.filter(v => v.verdict === "unsure" && v.reason.startsWith("Not judged: "));
    return { verdicts: all.filter(v => !notJudged.includes(v)), notJudged, unreadable: Math.max(0, tally - all.length) };
}

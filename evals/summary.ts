import type { Effort } from "@/engine/agent/request";
import type { AgentOutcome } from "@/engine/agent/run-aspect";
import type { ToolVersions } from "@/engine/scanners/types";
import type { ModelAccess } from "@/engine/types";

import type { KeyEntry } from "./fixtures";
import type { Grade, GradedFinding } from "./grade";
import type { Verdict } from "./judge";

export interface EvalResult {
    fixture: string;
    upstreamSha: string;
    preparedSha: string;
    model: string;
    effort: Effort;
    access: ModelAccess;
    aspects: string[];
    budget: { usd: number; tokens: number };
    startedAt: Date;
    durationMs: number;
    /** The commit of Auditdesk that ran, and whether its tree had uncommitted changes. */
    auditdesk: { commit: string; dirty: boolean };
    /** The first twelve hex digits of the key's sha256. */
    keyDigest: string;
    pricesAsOf: string;
    /** Why the audit stopped with an error; the grade covers what it filed before. */
    aborted: string | null;
    grade: Grade;
    entries: KeyEntry[];
    findings: GradedFinding[];
    /** Whether a finding outside the key counts as false (the fixture's `falseFindings`). */
    falseFindings: boolean;
    verdicts: Verdict[] | null;
    judge: { usd: number; unpriced: number; stopped: string | null } | null;
    byModel: { model: string; calls: number; usd: number; unpriced: number }[];
    /** Cache reads over all input-side tokens. */
    cacheReadShare: number;
    agents: {
        aspect: string;
        status: AgentOutcome["status"] | "not started";
        note: string | null;
        summary?: string | null;
        /** How many checklist items the agent reported as examined, partly, not examined, or not at all. */
        coverage?: { examined: number; partly: number; notExamined: number; notReported: number } | null;
    }[];
    versions: ToolVersions | null;
    /** Imports of deleted modules the prep removed: a finding about what they leave undefined is the prep's. */
    removedImports: string[];
}

const VERDICTS = ["matches_key", "known_issue", "true_unplanted", "false", "unsure"] as const;
const money = (x: number) => `$${x.toFixed(2)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function duration(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** The eval's result file (design § 5): what was run, how it scored, what it cost, and what pins it. */
export function summaryMarkdown(r: EvalResult): string {
    const g = r.grade;
    const entry = new Map(r.entries.map(e => [e.id, e]));
    const finding = new Map(r.findings.map(f => [f.label, f]));
    const verdict = new Map((r.verdicts ?? []).map(v => [v.finding, v]));
    const where = (f: GradedFinding | undefined) => {
        const e = f?.evidence[0];
        return e ? `${e.file}:${e.startLine}${e.endLine !== e.startLine ? `-${e.endLine}` : ""}` : "no location";
    };
    const describe = (label: string) => {
        const f = finding.get(label);
        const v = verdict.get(label);
        // One line each, and the marker once: model-written text must not pass for what the Evals
        // page and the spot-check read. Only a matched entry's ID is checked, so only it is written.
        const line = (t: string) => t.replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ");
        const title = line(f?.title ?? "").replaceAll(" — judge: ", " - judge: ");
        const key = v?.verdict === "matches_key" && v.key ? ` ${v.key}` : "";
        return `- ${label} (${f?.checklistItem ?? "no item"}, ${where(f)}): ${title}${v ? ` — judge: ${v.verdict}${key}; ${line(v.reason)}` : ""}`;
    };
    const by = (label: string) => `${label}${finding.get(label)?.source === "scanner" ? " (scanner)" : ""}`;
    const apiUsd = r.byModel.reduce((s, m) => s + m.usd, 0);
    const unpriced = r.byModel.reduce((s, m) => s + m.unpriced, 0);
    const calls = r.byModel.reduce((s, m) => s + m.calls, 0);
    const found = new Map<string, string[]>();
    for (const m of g.matched) found.set(m.key, [...(found.get(m.key) ?? []), by(m.finding)]);
    const scoped = r.entries.filter(e => g.scoped.includes(e.id));
    const besideLabels = [...new Set(g.locationOnly.map(l => l.finding))];
    const notStarted = r.agents.filter(a => a.status === "not started").map(a => a.aspect);

    const lines = [
        `# Eval: ${r.fixture}, ${r.model} at ${r.effort}`,
        "",
        ...(r.aborted ? [`- **Aborted:** ${r.aborted}`] : []),
        `- **Date:** ${r.startedAt.toISOString()}`,
        `- **Fixture:** ${r.fixture}, upstream \`${r.upstreamSha}\`, prepared \`${r.preparedSha}\``,
        `- **Auditdesk:** \`${r.auditdesk.commit}\`${r.auditdesk.dirty ? ", with uncommitted changes" : ""}; key digest \`${r.keyDigest}\`; prices as of ${r.pricesAsOf}`,
        `- **Aspects:** ${r.aspects.join(", ")}`,
        `- **Access:** ${r.access === "api_key" ? "API key (billed per token)" : "Claude plan (API-equivalent dollars, not billed)"}`,
        `- **Budget:** ${money(r.budget.usd)}, ${r.budget.tokens.toLocaleString("en-US")} tokens`,
        `- **Duration:** ${duration(r.durationMs)}; **calls:** ${calls}; **cache-read share:** ${pct(r.cacheReadShare)}`,
        "",
        "## Recall",
        "",
        `**${g.found} of ${g.total}** key entries found (${pct(g.recall)}); agents alone: ${g.foundByAgents} of ${g.total}.`,
        ...(notStarted.length ? ["", `Not started, so their entries count as missed: ${notStarted.join(", ")} (see Agents).`] : []),
        "",
        "| Entry | Item | Title | Found by |",
        "| --- | --- | --- | --- |",
        ...scoped.map(e => `| ${e.id} | ${e.checklistItem} | ${e.title} | ${found.get(e.id)?.join(", ") ?? "missed"} |`),
        ""
    ];
    if (r.verdicts) {
        const byJudge = new Set(r.verdicts.filter(v => v.verdict === "matches_key" && v.key && g.scoped.includes(v.key)).map(v => v.key!));
        const withJudge = scoped.filter(e => found.has(e.id) || byJudge.has(e.id)).length;
        lines.push(`With the judge's matches: **${withJudge} of ${g.total}** (${pct(g.total ? withJudge / g.total : 0)}).`, "");
    }
    if (g.locationOnly.length)
        lines.push(
            "Located under another item (not counted as found):",
            "",
            ...g.locationOnly.map(
                l => `- ${l.finding} on ${l.key} (${entry.get(l.key)?.checklistItem}), filed under ${l.item ?? "no item"}`
            ),
            ""
        );

    const judgedFalse = [...g.leftovers, ...besideLabels].filter(l => verdict.get(l)?.verdict === "false").length;
    lines.push(
        "## Findings outside the key",
        "",
        !r.falseFindings
            ? `Not counted as false: this fixture's key lists only its planted defects, so ${count(g.leftovers.length, "finding", "findings")} outside it and ${besideLabels.length} beside an entry under another item need a review.`
            : r.verdicts
              ? `**False findings: ${judgedFalse}** by the judge's verdicts, of ${g.leftovers.length + besideLabels.length} it was given.`
              : `**False findings: ${g.leftovers.length}**, and ${besideLabels.length} filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.`,
        "",
        ...g.leftovers.map(describe),
        ...(besideLabels.length && r.verdicts ? ["", "Beside an entry under another item:", ...besideLabels.map(describe)] : []),
        ...(g.known.length ? ["", `On known issues (neither found nor false): ${g.known.join(", ")}.`] : []),
        `Questions outside the key: ${g.questionsIgnored}.`,
        ...(g.outside.length ? [`Outside this run's aspects, not graded: ${g.outside.join(", ")}.`] : [])
    );
    if (r.verdicts && r.judge) {
        const tally = VERDICTS.map(v => [v, r.verdicts!.filter(x => x.verdict === v).length] as const)
            .filter(([, n]) => n)
            .map(([v, n]) => `${n} ${v}`)
            .join(", ");
        lines.push(
            "",
            `Judge: ${count(r.verdicts.length, "verdict", "verdicts")}: ${tally || "none"}. Cost ${money(r.judge.usd)}${r.judge.unpriced ? `, at least (${count(r.judge.unpriced, "call", "calls")} unpriced)` : ""}.`,
            ...(r.judge.stopped ? [`The judge stopped: ${r.judge.stopped}`] : [])
        );
    }
    lines.push(
        "",
        "## Cost",
        "",
        "| Model | Calls | Cost |",
        "| --- | --- | --- |",
        ...r.byModel.map(
            m =>
                `| ${m.model} | ${m.calls} | ${m.unpriced ? (m.usd ? `${money(m.usd)} + ${m.unpriced} unpriced` : "unpriced") : money(m.usd)} |`
        ),
        "",
        `Agents: ${money(apiUsd)}${unpriced ? `, at least (${count(unpriced, "call", "calls")} unpriced)` : ""}.`,
        "",
        "## Agents",
        "",
        "| Aspect | Status | Coverage | Summary or note |",
        "| --- | --- | --- | --- |",
        ...r.agents.map(a => {
            const c = a.coverage;
            const covered = c
                ? `${c.examined} examined, ${c.partly} partly, ${c.notExamined} not examined, ${c.notReported} not reported`
                : "";
            const text = [a.summary, a.note]
                .filter(Boolean)
                .join(" ")
                .replace(/\s*[\r\n]+\s*/g, " ")
                .replace(/\|/g, "\\|");
            return `| ${a.aspect} | ${a.status} | ${covered} | ${text} |`;
        }),
        "",
        "## What pins the result",
        ""
    );
    if (r.versions) {
        lines.push(
            ...Object.entries(r.versions.images).map(([tool, v]) => `- ${tool}: \`${v.digest || v.image}\``),
            ...r.versions.rulesets.map(s => `- Semgrep ruleset ${s.name}: ${s.sha256} (${s.rules} rules)`),
            `- OSV queried at ${r.versions.osvQueriedAt}`
        );
    } else lines.push("- The scanners did not run.");
    if (r.removedImports.length) lines.push(`- Imports of deleted modules, removed by the prep: ${r.removedImports.join("; ")}`);
    return `${lines.join("\n")}\n`;
}

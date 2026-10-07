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
    grade: Grade;
    entries: KeyEntry[];
    findings: GradedFinding[];
    /** Whether a finding outside the key counts as false (the fixture's `falseFindings`). */
    falseFindings: boolean;
    verdicts: Verdict[] | null;
    byModel: { model: string; calls: number; usd: number; unpriced: number }[];
    judgeUsd: number | null;
    /** Cache reads over all input-side tokens. */
    cacheReadShare: number;
    agents: { aspect: string; status: AgentOutcome["status"]; note: string | null }[];
    versions: ToolVersions | null;
}

const money = (x: number) => `$${x.toFixed(2)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function duration(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** The eval's result file (design § 5): what was run, how it scored, what it cost, and what pins it. */
export function summaryMarkdown(r: EvalResult): string {
    const g = r.grade;
    const entry = new Map(r.entries.map(e => [e.id, e]));
    const finding = new Map(r.findings.map(f => [f.label, f]));
    const where = (f: GradedFinding | undefined) => {
        const e = f?.evidence[0];
        return e ? `${e.file}:${e.startLine}${e.endLine !== e.startLine ? `-${e.endLine}` : ""}` : "no location";
    };
    const describe = (label: string) => {
        const f = finding.get(label);
        const v = r.verdicts?.find(x => x.finding === label);
        return `- ${label} (${f?.checklistItem ?? "no item"}, ${where(f)}): ${f?.title ?? ""}${v ? ` — judge: ${v.verdict}${v.key ? ` ${v.key}` : ""}; ${v.reason}` : ""}`;
    };
    const apiUsd = r.byModel.reduce((s, m) => s + m.usd, 0);
    const unpriced = r.byModel.reduce((s, m) => s + m.unpriced, 0);
    const calls = r.byModel.reduce((s, m) => s + m.calls, 0);
    const found = new Map<string, string[]>();
    for (const m of g.matched) found.set(m.key, [...(found.get(m.key) ?? []), m.finding]);
    const lines = [
        `# Eval: ${r.fixture}, ${r.model} at ${r.effort}`,
        "",
        `- **Date:** ${r.startedAt.toISOString()}`,
        `- **Fixture:** ${r.fixture}, upstream \`${r.upstreamSha}\`, prepared \`${r.preparedSha}\``,
        `- **Aspects:** ${r.aspects.join(", ")}`,
        `- **Access:** ${r.access === "api_key" ? "API key (billed per token)" : "Claude plan (API-equivalent dollars, not billed)"}`,
        `- **Budget:** ${money(r.budget.usd)}, ${r.budget.tokens.toLocaleString("en-US")} tokens`,
        `- **Duration:** ${duration(r.durationMs)}; **calls:** ${calls}; **cache-read share:** ${pct(r.cacheReadShare)}`,
        "",
        "## Recall",
        "",
        `**${g.found} of ${g.total}** key entries found (${pct(g.recall)}).`,
        "",
        "| Entry | Item | Title | Found by |",
        "| --- | --- | --- | --- |",
        ...r.entries
            .filter(e => g.missed.includes(e.id) || found.has(e.id))
            .map(e => `| ${e.id} | ${e.checklistItem} | ${e.title} | ${found.get(e.id)?.join(", ") ?? "missed"} |`),
        ""
    ];
    if (g.locationOnly.length)
        lines.push(
            "Located under another item (not counted as found):",
            "",
            ...g.locationOnly.map(
                l => `- ${l.finding} on ${l.key} (${entry.get(l.key)?.checklistItem}), filed under ${l.item ?? "no item"}`
            ),
            ""
        );
    lines.push(
        "## Findings outside the key",
        "",
        r.falseFindings
            ? `**False findings: ${g.leftovers.length}**, unless the judge or a review says otherwise.`
            : `Not counted as false: this fixture's key lists only its planted defects, so ${g.leftovers.length} findings outside it need a review.`,
        "",
        ...g.leftovers.map(describe),
        ...(g.known.length ? ["", `On known issues (neither found nor false): ${g.known.join(", ")}.`] : []),
        `Questions outside the key: ${g.questionsIgnored}.`,
        "",
        "## Cost",
        "",
        "| Model | Calls | Cost |",
        "| --- | --- | --- |",
        ...r.byModel.map(m => `| ${m.model} | ${m.calls} | ${m.unpriced ? `${money(m.usd)} + ${m.unpriced} unpriced` : money(m.usd)} |`),
        "",
        `Agents: ${money(apiUsd)}${unpriced ? `, at least (${unpriced} calls unpriced)` : ""}.${r.judgeUsd !== null ? ` Judge: ${money(r.judgeUsd)}.` : ""}`,
        "",
        "## Agents",
        "",
        "| Aspect | Status | Note |",
        "| --- | --- | --- |",
        ...r.agents.map(a => `| ${a.aspect} | ${a.status} | ${a.note ?? ""} |`),
        "",
        "## What pins the result",
        ""
    );
    if (r.versions) {
        lines.push(
            ...Object.entries(r.versions.images).map(([tool, v]) => `- ${tool}: \`${v.image}@${v.digest}\``),
            ...r.versions.rulesets.map(s => `- Semgrep ruleset ${s.name}: ${s.sha256} (${s.rules} rules)`),
            `- OSV queried at ${r.versions.osvQueriedAt}`
        );
    } else lines.push("- The scanners did not run.");
    return `${lines.join("\n")}\n`;
}

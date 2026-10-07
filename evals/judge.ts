import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { DEFAULT_EFFORT, DEFAULT_MODEL } from "@/engine/agent/request";
import { NOT_JUDGED } from "@/engine/eval-results";
import { priceMessage } from "@/engine/prices";

import type { AnswerKey, KeyEntry } from "./fixtures";
import { type GradedFinding, places } from "./grade";

export interface Verdict {
    finding: string;
    verdict: "matches_key" | "known_issue" | "true_unplanted" | "false" | "unsure";
    key: string | null;
    reason: string;
}

const VerdictSchema = z.object({
    verdict: z.enum(["matches_key", "known_issue", "true_unplanted", "false", "unsure"]),
    key_id: z.string().nullable(),
    reason: z.string()
});

const SYSTEM = `You grade one finding of a code audit against the answer key of a test fixture: the defects planted in it, and true issues it has that were not planted. The deterministic rules (same file, overlapping lines, same checklist item) did not match this finding. Decide which holds:
- matches_key: it is the same defect as a key entry, cited at another place or filed under another item. Give that entry's ID.
- known_issue: it is one of the known issues.
- true_unplanted: a real defect that the key does not list, as the cited code shows.
- false: not a defect, or not what the cited code shows.
- unsure: the finding and its code are not enough to tell.
The reason is one sentence. Judge only from what is given; do not assume code you cannot see.`;

const NEAREST = 5;
const VERDICTS = ["matches_key", "known_issue", "true_unplanted", "false", "unsure"] as const;

/**
 * The verdict's output format. SDK 0.131.0's schema transform moves `enum` into the description,
 * which the API does not enforce; structured outputs support a string enum, so it goes back.
 */
function verdictFormat() {
    const format = betaZodOutputFormat(VerdictSchema);
    (format.schema as { properties: { verdict: Record<string, unknown> } }).properties.verdict.enum = [...VERDICTS];
    return format;
}

/**
 * The key entries a finding most likely meant: the ones it was located on, then those in its files
 * (its item first, then the nearest lines), then those under its item, then under its aspect.
 */
function nearest(f: GradedFinding, entries: KeyEntry[], first: string[]): KeyEntry[] {
    const distance = (e: KeyEntry) =>
        Math.min(
            Infinity,
            ...places(e).flatMap(p =>
                f.evidence.filter(ev => ev.file === p.file).map(ev => Math.max(0, p.startLine - ev.endLine, ev.startLine - p.endLine))
            )
        );
    const sameItem = (e: KeyEntry) => (e.checklistItem === f.checklistItem ? 0 : 1);
    const ranked = entries.map((e, i) => {
        const d = distance(e);
        const group = first.includes(e.id) ? 0 : d < Infinity ? 1 : sameItem(e) === 0 ? 2 : e.aspect === f.aspect ? 3 : null;
        return { e, key: group === null ? null : [group, sameItem(e), d, i] };
    });
    return ranked
        .filter((x): x is { e: KeyEntry; key: number[] } => x.key !== null)
        .sort((a, b) => {
            const k = a.key.findIndex((v, i) => v !== b.key[i]);
            return k === -1 ? 0 : a.key[k] - b.key[k];
        })
        .slice(0, NEAREST)
        .map(x => x.e);
}

function prompt(f: GradedFinding, key: AnswerKey, first: string[]): string {
    const where = (e: { file?: string; startLine?: number; endLine?: number }) =>
        e.file ? `${e.file}:${e.startLine}${e.endLine !== e.startLine ? `-${e.endLine}` : ""}` : "no location";
    const evidence = f.evidence.length
        ? f.evidence.map(e => `- ${where(e)}${e.snippet ? `\n\`\`\`\n${e.snippet}\n\`\`\`` : ""}`).join("\n")
        : "- none cited";
    const entries = nearest(f, key.entries, first)
        .map(
            e =>
                `- ${e.id} (${e.kind}, ${[e.checklistItem, ...(e.alsoItems ?? [])].join(" or ")}) at ${[where(e), ...(e.also ?? []).map(where)].join(", ")}: ${e.title}`
        )
        .join("\n");
    const known = key.known.map(k => `- ${k.checklistItem}${k.file ? ` in ${k.file}` : ""}: ${k.title}`).join("\n");
    return [
        `Finding ${f.label} (${f.kind}, ${f.aspect}, ${f.checklistItem ?? "no item"}): ${f.title}`,
        f.summary ? `Summary: ${f.summary}` : "",
        `Evidence:\n${evidence}`,
        `Nearest key entries:\n${entries || "- none"}`,
        `Known issues:\n${known || "- none"}`
    ]
        .filter(Boolean)
        .join("\n\n");
}

/**
 * The LLM judge for the findings the grader could not place (design § 11): one call per finding on
 * the default model and effort, a strict verdict Andrii spot-checks. A declined or unreadable answer,
 * or one naming an entry the key does not have, is "unsure", never "false". It stops at `capUsd`
 * and on an API error, keeping the verdicts it has. Live: `pnpm eval` calls it only with --judge.
 */
export async function judgeLeftovers(
    client: Anthropic,
    findings: GradedFinding[],
    key: AnswerKey,
    o: { located?: Map<string, string[]>; capUsd?: number } = {}
): Promise<{ verdicts: Verdict[]; costUsd: number; unpriced: number; stopped: string | null }> {
    const verdicts: Verdict[] = [];
    let costUsd = 0;
    let unpriced = 0;
    let stopped: string | null = null;
    const ids = new Set(key.entries.map(e => e.id));
    for (const f of findings) {
        const unsure = (reason: string): Verdict => ({ finding: f.label, verdict: "unsure", key: null, reason });
        if (stopped) {
            verdicts.push(unsure(NOT_JUDGED.stopped(stopped)));
            continue;
        }
        if (o.capUsd !== undefined && costUsd >= o.capUsd) {
            verdicts.push(unsure(NOT_JUDGED.cap));
            continue;
        }
        try {
            const m = await client.beta.messages
                .stream({
                    model: DEFAULT_MODEL,
                    max_tokens: 16_000,
                    thinking: { type: "adaptive" },
                    output_config: { effort: DEFAULT_EFFORT, format: verdictFormat() },
                    system: SYSTEM,
                    messages: [{ role: "user", content: prompt(f, key, o.located?.get(f.label) ?? []) }]
                })
                .finalMessage();
            const cost = priceMessage(DEFAULT_MODEL, m).costUsd;
            if (cost === null) unpriced++;
            else costUsd += cost;
            const v = m.stop_reason === "refusal" ? null : m.parsed_output;
            if (!v) verdicts.push(unsure(NOT_JUDGED.declined));
            else if (v.verdict === "matches_key" && !ids.has(v.key_id ?? "")) verdicts.push(unsure(NOT_JUDGED.unknownEntry(v.key_id)));
            else verdicts.push({ finding: f.label, verdict: v.verdict, key: v.key_id, reason: v.reason });
        } catch (e) {
            if (e instanceof Anthropic.APIError) {
                stopped = e.message;
                verdicts.push(unsure(NOT_JUDGED.stopped(stopped)));
            } else if (e instanceof SyntaxError || e instanceof Anthropic.AnthropicError) verdicts.push(unsure(NOT_JUDGED.schema));
            else throw e;
        }
    }
    return { verdicts, costUsd, unpriced, stopped };
}

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { DEFAULT_EFFORT, DEFAULT_MODEL } from "@/engine/agent/request";
import { priceMessage } from "@/engine/prices";

import type { AnswerKey, KeyEntry } from "./fixtures";
import type { GradedFinding } from "./grade";

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

/** The key entries a leftover most likely meant: same file, then same item, then same aspect. */
function nearest(f: GradedFinding, entries: KeyEntry[]): KeyEntry[] {
    const files = new Set(f.evidence.map(e => e.file));
    const rank = (e: KeyEntry) =>
        [e.file, ...(e.also ?? []).map(a => a.file)].some(file => file && files.has(file))
            ? 0
            : e.checklistItem === f.checklistItem
              ? 1
              : e.aspect === f.aspect
                ? 2
                : null;
    return entries
        .map((e, i) => ({ e, i, r: rank(e) }))
        .filter(x => x.r !== null)
        .sort((a, b) => a.r! - b.r! || a.i - b.i)
        .slice(0, NEAREST)
        .map(x => x.e);
}

function prompt(f: GradedFinding, key: AnswerKey): string {
    const where = (e: { file?: string; startLine?: number; endLine?: number }) =>
        e.file ? `${e.file}:${e.startLine}${e.endLine !== e.startLine ? `-${e.endLine}` : ""}` : "no location";
    const evidence = f.evidence.length
        ? f.evidence.map(e => `- ${where(e)}${e.snippet ? `\n\`\`\`\n${e.snippet}\n\`\`\`` : ""}`).join("\n")
        : "- none cited";
    const entries = nearest(f, key.entries)
        .map(e => `- ${e.id} (${e.kind}, ${e.checklistItem}) at ${[where(e), ...(e.also ?? []).map(where)].join(", ")}: ${e.title}`)
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
 * The LLM judge for the grader's leftovers (design § 11): one call per finding on the default model
 * and effort, a strict verdict Andrii spot-checks. A declined or unreadable answer is "unsure",
 * never "false". Live: `pnpm eval` calls it only with --judge.
 */
export async function judgeLeftovers(
    client: Anthropic,
    leftovers: GradedFinding[],
    key: AnswerKey
): Promise<{ verdicts: Verdict[]; costUsd: number }> {
    const verdicts: Verdict[] = [];
    let costUsd = 0;
    for (const f of leftovers) {
        const unsure = (reason: string): Verdict => ({ finding: f.label, verdict: "unsure", key: null, reason });
        try {
            const m = await client.beta.messages
                .stream({
                    model: DEFAULT_MODEL,
                    max_tokens: 16_000,
                    thinking: { type: "adaptive" },
                    output_config: { effort: DEFAULT_EFFORT, format: betaZodOutputFormat(VerdictSchema) },
                    system: SYSTEM,
                    messages: [{ role: "user", content: prompt(f, key) }]
                })
                .finalMessage();
            costUsd += priceMessage(DEFAULT_MODEL, m).costUsd ?? 0;
            const v = m.stop_reason === "refusal" ? null : m.parsed_output;
            verdicts.push(
                v ? { finding: f.label, verdict: v.verdict, key: v.key_id, reason: v.reason } : unsure("The judge declined to answer.")
            );
        } catch (e) {
            // The parser's own failures only; an API error stops the run.
            if (e instanceof Anthropic.APIError || !(e instanceof SyntaxError || e instanceof Anthropic.AnthropicError)) throw e;
            verdicts.push(unsure("The judge's answer did not match the verdict schema."));
        }
    }
    return { verdicts, costUsd };
}

import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { parseChecklist } from "@/engine/checklists";
import { message } from "@/engine/replay";

/** Recorded model turns for the aspect agents' tests, on either engine. */
export const CHECKLIST = parseChecklist("security", "# Security\n\n## SEC-01 Authentication\n\n## SEC-04 Injection\n");

let n = 0;
export const tool = (name: string, input: object, extra: Partial<BetaMessage> = {}) =>
    message({ content: [{ type: "tool_use", id: `toolu_${++n}`, name, input, caller: null }], stop_reason: "tool_use", ...extra } as never);
export const text = (t: string) => message({ content: [{ type: "text", text: t, citations: null }], stop_reason: "end_turn" } as never);
export const finding = (over: object = {}) => ({
    kind: "finding",
    checklist_item: "SEC-04",
    title: "Raw SQL from the query string",
    severity: "high",
    likelihood: "Any visitor can reach it.",
    impact: "Reads every user record.",
    summary: "s",
    explanation: "e",
    recommendation: "r",
    effort_hours: { low: 1, high: 2 },
    evidence: [{ file: "src/db.js", start_line: 2, end_line: 2 }],
    cwe: "CWE-89",
    tags: [],
    ...over
});
export const finish = (coverage = [{ item: "SEC-04", status: "examined" }]) => tool("finish_aspect", { summary: "Done.", coverage });

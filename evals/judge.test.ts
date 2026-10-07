import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { message, replayFetch } from "@/engine/replay";
import { text } from "@/test/agent-messages";

import type { AnswerKey } from "./fixtures";
import type { GradedFinding } from "./grade";
import { judgeLeftovers } from "./judge";

const KEY: AnswerKey = {
    fixture: "own",
    entries: [
        {
            id: "OWN-01",
            aspect: "security",
            checklistItem: "SEC-03",
            kind: "finding",
            severity: "high",
            title: "Any customer can read another customer's order",
            file: "src/orders.ts",
            startLine: 8,
            endLine: 11,
            anchor: "x"
        },
        {
            id: "OWN-02",
            aspect: "security",
            checklistItem: "SEC-05",
            kind: "finding",
            severity: "high",
            title: "Descriptions rendered as raw HTML",
            file: "src/page.tsx",
            startLine: 16,
            endLine: 16,
            anchor: "y"
        },
        { id: "OWN-03", aspect: "production", checklistItem: "PRD-04", kind: "absence", severity: "medium", title: "No health check" }
    ],
    known: [{ checklistItem: "QUA-02", title: "Few tests for the checkout" }]
};

const leftover = (label: string, over: Partial<GradedFinding>): GradedFinding => ({
    label,
    kind: "finding",
    aspect: "security",
    checklistItem: "SEC-01",
    title: "t",
    summary: "s",
    evidence: [],
    ...over
});

const client = (fetch: typeof globalThis.fetch) => new Anthropic({ apiKey: "test", fetch, maxRetries: 0 });

describe("judgeLeftovers", () => {
    it("sends each leftover with the nearest key entries and reads a strict verdict", async () => {
        const { fetch, requests } = replayFetch([
            text(JSON.stringify({ verdict: "matches_key", key_id: "OWN-01", reason: "The same check, cited further down." })),
            text(JSON.stringify({ verdict: "false", key_id: null, reason: "The query is parameterised." }))
        ]);
        const out = await judgeLeftovers(
            client(fetch),
            [
                leftover("F-003", { title: "Orders readable by ID", evidence: [{ file: "src/orders.ts", startLine: 20, endLine: 22 }] }),
                leftover("F-004", {
                    checklistItem: "SEC-04",
                    title: "SQL injection",
                    evidence: [{ file: "src/search.ts", startLine: 3, endLine: 3 }]
                })
            ],
            KEY
        );
        expect(out.verdicts).toEqual([
            { finding: "F-003", verdict: "matches_key", key: "OWN-01", reason: "The same check, cited further down." },
            { finding: "F-004", verdict: "false", key: null, reason: "The query is parameterised." }
        ]);
        expect(requests).toHaveLength(2);
        const body = requests[0].body as { model: string; output_config: { effort: string; format: { type: string } } };
        expect(body.model).toBe("claude-sonnet-5-5");
        expect(body.output_config.effort).toBe("low");
        expect(body.output_config.format.type).toBe("json_schema");
        const sent = JSON.stringify(requests[0].body);
        expect(sent).toContain("Orders readable by ID");
        expect(sent.indexOf("OWN-01")).toBeGreaterThan(-1);
        expect(sent.indexOf("OWN-01")).toBeLessThan(sent.indexOf("OWN-02"));
        expect(sent).not.toContain("OWN-03");
        expect(sent).toContain("Few tests for the checkout");
        expect(out.costUsd).toBeGreaterThan(0);
    });

    it("records a declined or unreadable verdict as unsure, never as false", async () => {
        const { fetch } = replayFetch([message({ content: [], stop_reason: "refusal" }), text("Not JSON at all.")]);
        const out = await judgeLeftovers(client(fetch), [leftover("F-001", {}), leftover("F-002", {})], KEY);
        expect(out.verdicts.map(v => v.verdict)).toEqual(["unsure", "unsure"]);
    });
});

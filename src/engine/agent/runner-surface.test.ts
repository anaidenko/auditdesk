import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { message, replayFetch } from "@/engine/replay";

const BETAS = ["server-side-fallback-2026-07-01", "task-budgets-2026-03-13", "thinking-display-updates-2026-08-18"];

function params(tools: BetaRunnableTool[]) {
    return {
        model: "claude-opus-5-5",
        max_tokens: 64000,
        stream: true as const,
        betas: BETAS,
        fallbacks: "default" as const,
        thinking: { type: "adaptive" as const, display: "updates" as const },
        output_config: { effort: "medium" as const, task_budget: { type: "tokens" as const, total: 50000 } },
        cache_control: { type: "ephemeral" as const },
        tools,
        messages: [{ role: "user" as const, content: "Audit." }]
    };
}

describe("SDK tool runner surface (@anthropic-ai/sdk 0.131.0)", () => {
    it("sends strict schemas, fallbacks, the task budget and the betas, and runs the tool", async () => {
        const calls: string[] = [];
        const echo = {
            ...betaZodTool({
                name: "echo",
                description: "Echo a word.",
                inputSchema: z.strictObject({ word: z.string() }),
                run: async ({ word }) => {
                    calls.push(word);
                    return word;
                }
            }),
            strict: true
        };
        const { fetch, requests } = replayFetch([
            message({
                content: [{ type: "tool_use", id: "toolu_1", name: "echo", input: { word: "hi" }, caller: null }],
                stop_reason: "tool_use"
            } as never),
            message({ content: [{ type: "text", text: "done", citations: null }], stop_reason: "end_turn" } as never)
        ]);
        const client = new Anthropic({ apiKey: "test", fetch, maxRetries: 0 });
        const runner = client.beta.messages.toolRunner(params([echo]));
        for await (const stream of runner) await stream.finalMessage();

        expect(calls).toEqual(["hi"]);
        expect(requests).toHaveLength(2);
        const first = requests[0];
        expect(first.headers["anthropic-beta"].split(",")).toEqual(expect.arrayContaining(BETAS));
        expect(first.body.fallbacks).toBe("default");
        expect(first.body.output_config).toEqual({ effort: "medium", task_budget: { type: "tokens", total: 50000 } });
        expect(first.body.thinking).toEqual({ type: "adaptive", display: "updates" });
        const tool = (first.body.tools as Record<string, unknown>[])[0];
        expect(tool.strict).toBe(true);
        expect((tool.input_schema as Record<string, unknown>).additionalProperties).toBe(false);
    });

    it("turns an error thrown by a tool into an is_error tool result", async () => {
        const failing = betaZodTool({
            name: "fail",
            description: "Always fails.",
            inputSchema: z.strictObject({}),
            run: async () => {
                throw new Error("path escapes the clone");
            }
        });
        const { fetch, requests } = replayFetch([
            message({
                content: [{ type: "tool_use", id: "toolu_1", name: "fail", input: {}, caller: null }],
                stop_reason: "tool_use"
            } as never),
            message({ content: [{ type: "text", text: "ok", citations: null }], stop_reason: "end_turn" } as never)
        ]);
        const runner = new Anthropic({ apiKey: "test", fetch, maxRetries: 0 }).beta.messages.toolRunner(params([failing]));
        for await (const stream of runner) await stream.finalMessage();

        const second = requests[1].body.messages as { role: string; content: { type: string; is_error?: boolean; content?: unknown }[] }[];
        const result = second.at(-1)!.content.find(b => b.type === "tool_result")!;
        expect(result.is_error).toBe(true);
        expect(JSON.stringify(result.content)).toContain("path escapes the clone");
    });

    it("runs pending tools on demand, so a break after them sends no further request", async () => {
        const calls: string[] = [];
        const finish = betaZodTool({
            name: "finish",
            description: "Finish.",
            inputSchema: z.strictObject({ summary: z.string() }),
            run: async ({ summary }) => {
                calls.push(summary);
                return "finished";
            }
        });
        const { fetch, requests } = replayFetch([
            message({
                content: [{ type: "tool_use", id: "toolu_1", name: "finish", input: { summary: "s" }, caller: null }],
                stop_reason: "tool_use"
            } as never)
        ]);
        const runner = new Anthropic({ apiKey: "test", fetch, maxRetries: 0 }).beta.messages.toolRunner(params([finish]));
        for await (const stream of runner) {
            await stream.finalMessage();
            await runner.generateToolResponse();
            break;
        }
        expect(calls).toEqual(["s"]);
        expect(requests).toHaveLength(1);
    });

    it("exposes the conversation so far through runner.params", async () => {
        const { fetch } = replayFetch([
            message({ content: [{ type: "text", text: "no tools", citations: null }], stop_reason: "end_turn" } as never)
        ]);
        const runner = new Anthropic({ apiKey: "test", fetch, maxRetries: 0 }).beta.messages.toolRunner(params([]));
        for await (const stream of runner) await stream.finalMessage();
        const roles = runner.params.messages.map(m => m.role);
        expect(roles).toEqual(["user", "assistant"]);
    });
});

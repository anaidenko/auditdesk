import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessage, BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { exhausted } from "../budget";
import { priceMessage } from "../prices";

import { type Effort, agentParams } from "./request";
import { type AgentContext, type Coverage, makeTools } from "./tools";

export type AgentOutcome = {
    status: "done" | "partial" | "declined" | "stopped" | "failed";
    note: string | null;
    summary: string | null;
    coverage: Coverage[];
};

const NUDGE = "You ended without calling finish_aspect. Call it now with your summary and the coverage of every checklist item.";

export async function runAspect(o: {
    client: Anthropic;
    model: string;
    effort: Effort;
    share: { usd: number; tokens: number };
    ctx: AgentContext;
    system: BetaTextBlockParam[];
    firstMessage: string;
    maxIterations?: number;
}): Promise<AgentOutcome> {
    const { ctx } = o;
    const tools = makeTools(ctx);
    const notCovered = (): Coverage[] => ctx.checklist.items.map(i => ({ item: i.id, status: "not_examined" }));
    const end = (status: AgentOutcome["status"], note: string | null): AgentOutcome => ({
        status,
        note,
        summary: ctx.state.finished?.summary ?? null,
        coverage: ctx.state.finished?.coverage ?? notCovered()
    });

    // The history is append-only: a nudge is a new user turn after everything sent so far (design § 8).
    let messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: o.firstMessage }];
    for (let attempt = 0; attempt < 2; attempt++) {
        const runner = o.client.beta.messages.toolRunner(
            agentParams({
                model: o.model,
                effort: o.effort,
                system: o.system,
                tools,
                messages,
                taskBudget: o.share.tokens,
                maxIterations: o.maxIterations ?? 60
            })
        );
        let last: BetaMessage | null = null;
        try {
            for await (const stream of runner) {
                const msg = await stream.finalMessage();
                last = msg;
                const priced = priceMessage(o.model, msg);
                await ctx.sink.recordCall({
                    agentRunId: ctx.agentRunId,
                    requestedModel: o.model,
                    servedModel: priced.servedModel,
                    fallback: priced.fallback,
                    usage: priced.usage,
                    costUsd: priced.costUsd,
                    stopReason: msg.stop_reason,
                    refusalCategory: msg.stop_details?.category ?? null
                });
                dropDeclinedPartial(msg.content);
                for (const b of msg.content)
                    if (b.type === "thinking" && b.thinking.trim()) await ctx.sink.progress(`${ctx.aspect}: ${b.thinking.trim()}`);

                // A refusal can cut a tool call off mid-input: never run that turn's tools.
                if (msg.stop_reason === "refusal") {
                    const category = msg.stop_details?.category ?? "unspecified";
                    return end("declined", `Not covered (declined, category ${category}${priced.fallback ? ", after a fallback" : ""}).`);
                }
                if (msg.stop_reason === "max_tokens") return end("partial", "A turn hit max_tokens; its tool calls were not run.");

                // Run this turn's tools now, so a finding filed in the last turn is kept when we stop below.
                if (msg.content.some(b => b.type === "tool_use")) {
                    const results = await runner.generateToolResponse();
                    if (ctx.state.finished && results && reopenAfterFailedSibling(msg, results)) ctx.state.finished = null;
                }
                if (ctx.state.fatal) throw ctx.state.fatal;
                if (ctx.state.finished) return end("done", null);
                if (await ctx.sink.stopRequested()) return end("stopped", "Stopped by the auditor.");
                const spend = await ctx.sink.agentSpend(ctx.agentRunId);
                if (exhausted(spend, o.share)) {
                    return end(
                        "partial",
                        spend.unpriced
                            ? "Stopped: budget unknown, because a call was served by a model with no price row."
                            : "Partially covered: the budget share was spent."
                    );
                }
            }
        } catch (e) {
            if (e instanceof Anthropic.APIError) return end("failed", `API error ${e.status ?? ""}: ${e.message}`);
            throw e;
        }
        if (last?.stop_reason !== "end_turn") return end("partial", "Partially covered: the turn limit was reached.");
        messages = [...(runner.params.messages as typeof messages), { role: "user", content: NUDGE }];
    }
    return end("partial", "Finished without reporting coverage.");
}

/**
 * After a mid-output fallback, the declined model's thinking and tool calls before the last
 * `fallback` block are neither run nor sent back (claude-api skill, refusal section: "Echoing
 * fallback turns back"). The runner runs and echoes this same array, so it is edited in place.
 */
export function dropDeclinedPartial(content: BetaContentBlock[]): void {
    const boundary = content.findLastIndex(b => b.type === "fallback");
    if (boundary < 0) return;
    const kept = content.filter((b, i) => i >= boundary || b.type === "text");
    content.splice(0, content.length, ...kept);
}

/**
 * finish_aspect beside a call that failed would end the aspect before the model saw the error,
 * and the failed finding would be lost. Its result becomes an error instead, so the model fixes
 * the call and finishes again. The runner sends this same results message, so it is edited in place.
 */
function reopenAfterFailedSibling(msg: BetaMessage, results: { content: unknown }): boolean {
    const finishIds = new Set(
        msg.content.filter(b => b.type === "tool_use" && b.name === "finish_aspect").map(b => (b as { id: string }).id)
    );
    const blocks = Array.isArray(results.content)
        ? (results.content as { tool_use_id: string; is_error?: boolean; content: unknown }[])
        : [];
    if (!blocks.some(r => r.is_error && !finishIds.has(r.tool_use_id))) return false;
    for (const r of blocks)
        if (finishIds.has(r.tool_use_id)) {
            r.content = "Not finished: another call in this turn failed. Fix it, then call finish_aspect again.";
            r.is_error = true;
        }
    return true;
}

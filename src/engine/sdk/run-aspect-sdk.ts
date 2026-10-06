import { type HookCallback, type Options, type PostToolBatchHookInput, query } from "@anthropic-ai/claude-agent-sdk";
import type { BetaMessage, BetaRawMessageDeltaEvent, BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";

import { APPROVED_FALLBACKS } from "../agent/request";
import { type AgentOutcome, type AspectInput, type AspectRunner, NUDGE, REOPEN, outcomeOf } from "../agent/run-aspect";
import type { AgentContext } from "../agent/tools";
import { exhausted } from "../budget";
import { PLAN_RESERVE, clock, percent, readPlanUsage, recordPlanUsage, reserveRefusal } from "../plan-usage";
import { priceMessage } from "../prices";
import type { CallRecord, ModelAccess } from "../types";

import { InputQueue } from "./input";
import { sdkEnv, sdkOptions } from "./options";
import { SERVER, makeSdkServer } from "./tools";

export interface SdkRunnerConfig {
    access: ModelAccess;
    credential: string;
    /** The run's folder under WORKSPACE_DIR: each agent's empty cwd and the subprocess's config live there, never in the clone. */
    runDir: string;
    /** Tests and replayed runs only: the fake server. */
    baseUrl?: string;
    extraEnv?: Record<string, string>;
    /** Andrii's permission for this start to use more than PLAN_RESERVE of the plan's 5-hour window. */
    allowPastReserve?: boolean;
    /** Tests only: the control of the isolation test. */
    override?: Partial<Options>;
}

/** Where Claude Code says its credential came from; anything else means another one reached the subprocess. */
const KEY_SOURCE: Record<ModelAccess, string> = { api_key: "ANTHROPIC_API_KEY", claude_plan: "none" };

// The system prompt names the tools bare; the SDK serves them under the MCP server's prefix.
const TOOL_NOTE = `Your tools are served as mcp__${SERVER}__<name>: mcp__${SERVER}__read_file is read_file above, and so on.`;

const WINDOW: Record<string, string> = {
    five_hour: "5-hour",
    seven_day: "weekly",
    seven_day_opus: "weekly Opus",
    seven_day_sonnet: "weekly Sonnet",
    overage: "extra-usage"
};

/** What `rate_limit_event` carries beyond its public type: `@internal` in the d.ts (Task E.1, Deviation 8). */
type PlanWindows = { unifiedWindows?: { five_hour?: { utilization: number; resetsAt: number } } };

export function sdkAspectRunner(cfg: SdkRunnerConfig): AspectRunner {
    return o => runAspectSdk(cfg, o);
}

type Stop = { status: AgentOutcome["status"]; note: string };

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => (resolve = r));
    return { promise, resolve };
}

/**
 * The stop reason of the main-thread response that made each tool call. The CLI starts a call
 * while its response still streams (Task E.1, Deviation 5), and runs tools and hooks in its own
 * order while the stream reaches us in another, so a writing tool and the PostToolBatch hook wait
 * here for the response's end. null: the response never ended (an API error, or the session closed).
 */
class Responses {
    private streaming: string[] = [];
    private waits = new Map<string, ReturnType<typeof deferred<string | null>>>();

    toolUse(id: string): void {
        this.streaming.push(id);
    }

    end(stopReason: string | null): void {
        for (const id of this.streaming) this.slot(id).resolve(stopReason);
        this.streaming = [];
    }

    /** Releases every call still waiting: no response will end for it. */
    abort(): void {
        this.streaming = [];
        for (const d of this.waits.values()) d.resolve(null);
    }

    stopReasonOf(id: string): Promise<string | null> {
        return this.slot(id).promise;
    }

    private slot(id: string) {
        let d = this.waits.get(id);
        if (!d) this.waits.set(id, (d = deferred<string | null>()));
        return d;
    }
}

export async function runAspectSdk(cfg: SdkRunnerConfig, o: AspectInput): Promise<AgentOutcome> {
    const { ctx } = o;
    const end = (status: AgentOutcome["status"], note: string | null) => outcomeOf(ctx, status, note);
    const dir = join(cfg.runDir, "sdk", ctx.agentRunId);
    await mkdir(join(dir, "cwd"), { recursive: true });
    await mkdir(join(dir, "config"), { recursive: true });
    const plan = cfg.access === "claude_plan";
    if (plan) {
        const refusal = reserveRefusal(await readPlanUsage(), !!cfg.allowPastReserve);
        if (refusal) return end("partial", `Not started. ${refusal} Re-run this aspect then, or allow it past the reserve.`);
    }

    const approved = [o.model, ...(APPROVED_FALLBACKS[o.model] ?? [])];
    const responses = new Responses();
    let start: { model: string; usage: BetaUsage } | null = null;
    let stop: Stop | null = null;
    let declined: string | null = null;
    let fellBack = false;
    let planLimit: { window: string; resetsAt?: number } | null = null;
    let apiError: string | null = null;
    let reopen = false;
    let nudged = false;
    let failedInBatch = 0;

    // The sink's writes, in stream order. The loop below never awaits, so it keeps pace with the
    // stream and a hook that yields once sees every message the CLI sent before calling it.
    let writes: Promise<void> = Promise.resolve();
    let writeError: Error | null = null;
    const write = (fn: () => Promise<void>) => {
        writes = writes.then(fn).catch(e => void (writeError ??= e as Error));
    };

    // The same order as the API engine: a stop request, then the budget share.
    const check = async (): Promise<Stop | null> => {
        if (await ctx.sink.stopRequested()) return { status: "stopped", note: "Stopped by the auditor." };
        const spend = await ctx.sink.agentSpend(ctx.agentRunId);
        if (!exhausted(spend, o.share)) return null;
        return {
            status: "partial",
            note: spend.unpriced
                ? "Stopped: budget unknown, because a call was served by a model with no price row."
                : "Partially covered: the budget share was spent."
        };
    };

    /**
     * Once a turn's tools have all run and before the next request, as the API engine checks
     * (run-aspect.ts): a finding filed in the last turn is kept, and nothing races the CLI.
     */
    const afterBatch: HookCallback = async input => {
        const reasons = await Promise.all((input as PostToolBatchHookInput).tool_calls.map(c => responses.stopReasonOf(c.tool_use_id)));
        await tick();
        await writes;
        const failed = failedInBatch;
        failedInBatch = 0;
        if (ctx.state.fatal || writeError) return { continue: false, stopReason: "A tool failed internally." };
        // finish_aspect before a call that failed: the model fixes the call and finishes again (run-aspect.ts).
        if (ctx.state.finished && failed) {
            ctx.state.finished = null;
            reopen = true;
        }
        // Claude Code goes on after a refusal it cannot route while tool results exist (Task E.1, Deviation 5).
        if (declined) return { continue: false, stopReason: "Declined." };
        if (!stop && reasons.includes("max_tokens"))
            stop = { status: "partial", note: "A turn hit max_tokens; its tool calls were not run." };
        if (!ctx.state.finished && !stop) stop = await check();
        return stop ? { continue: false, stopReason: stop.note } : {};
    };

    const { server, names } = makeSdkServer(ctx, {
        onToolError: name => void (name !== "finish_aspect" && failedInBatch++),
        gate: async (name, id) => {
            if (!id) return "Not run: the call carried no tool-use id.";
            const reason = await responses.stopReasonOf(id);
            if (reason === "refusal") return "Not run: the response that made this call was declined.";
            if (reason !== "tool_use") return `Not run: the response that made this call ended with ${reason ?? "an error"}.`;
            // The calls before it in this turn have run (a writing call runs alone, Task E.1): one failed, so it reopens.
            return name === "finish_aspect" && failedInBatch ? REOPEN : null;
        }
    });
    const input = new InputQueue();
    input.push(o.firstMessage);
    const stderr: string[] = [];
    const q = query({
        prompt: input,
        options: {
            ...sdkOptions({
                model: o.model,
                effort: o.effort,
                taskBudget: o.share.tokens,
                maxTurns: o.maxIterations ?? 60,
                systemPrompt: [...o.system.map(b => b.text), TOOL_NOTE],
                server,
                toolNames: names,
                cwd: join(dir, "cwd"),
                env: sdkEnv({
                    access: cfg.access,
                    credential: cfg.credential,
                    configDir: join(dir, "config"),
                    baseUrl: cfg.baseUrl,
                    extra: cfg.extraEnv
                }),
                hooks: { PostToolBatch: [{ hooks: [afterBatch] }] },
                stderr: s => void stderr.push(s)
            }),
            ...cfg.override
        }
    });

    try {
        for await (const m of q) {
            switch (m.type) {
                case "system":
                    if (m.subtype === "init") {
                        const tools = m.tools.filter(t => !names.includes(t));
                        const servers = m.mcp_servers.map(s => s.name).filter(n => n !== SERVER);
                        if (tools.length || servers.length || m.apiKeySource !== KEY_SOURCE[cfg.access])
                            return end(
                                "failed",
                                `Isolation check failed (extra tools: ${tools.join(", ") || "none"}; extra MCP servers: ${servers.join(", ") || "none"}; credential source: ${m.apiKeySource}).`
                            );
                    } else if (m.subtype === "model_refusal_no_fallback") declined = m.api_refusal_category ?? "unspecified";
                    else if (m.subtype === "model_refusal_fallback") {
                        declined = null;
                        fellBack = true;
                        const note = `${ctx.aspect}: declined (${m.api_refusal_category ?? "unspecified"}); retried on ${m.fallback_model}.`;
                        write(() => ctx.sink.progress(note, "warn"));
                    }
                    break;
                case "stream_event":
                    if (m.parent_tool_use_id) break;
                    if (m.event.type === "message_start") start = { model: m.event.message.model, usage: m.event.message.usage };
                    else if (m.event.type === "content_block_start" && m.event.content_block.type === "tool_use")
                        responses.toolUse(m.event.content_block.id);
                    else if (m.event.type === "message_delta" && start) {
                        const call = callRecord(ctx, o.model, start, m.event, fellBack);
                        write(() => ctx.sink.recordCall(call));
                        fellBack = false;
                        start = null;
                        // Decision for Andrii 5: one call on a model he did not approve, then the agent stops.
                        if (!approved.includes(call.servedModel) && !stop)
                            stop = {
                                status: "partial",
                                note: `Stopped: a call was served by ${call.servedModel}, which this run did not approve.`
                            };
                        responses.end(m.event.delta.stop_reason);
                    }
                    break;
                case "assistant":
                    if (m.parent_tool_use_id) break;
                    if (m.error) {
                        apiError = m.error;
                        responses.abort();
                    }
                    for (const b of m.message.content)
                        if (b.type === "tool_use") {
                            const note = `${ctx.aspect}: ${b.name.replace(`mcp__${SERVER}__`, "")} ${JSON.stringify(b.input).slice(0, 120)}`;
                            write(() => ctx.sink.progress(note));
                        }
                    break;
                case "rate_limit_event": {
                    const info = m.rate_limit_info;
                    // Extra usage is off on Andrii's account; if it ever pays for a call, the agent stops (Task E.7a).
                    if (info.isUsingOverage && !stop)
                        stop = { status: "partial", note: "Stopped: extra usage paid for a call; this tool spends none." };
                    else if (info.status === "rejected" && info.rateLimitType)
                        planLimit = { window: info.rateLimitType, resetsAt: info.resetsAt };
                    const fiveHour = (info as PlanWindows).unifiedWindows?.five_hour;
                    if (fiveHour) {
                        const note = `Claude plan: 5-hour usage ${percent(fiveHour.utilization)}, resets ${clock(fiveHour.resetsAt)}.`;
                        write(() => ctx.sink.progress(note));
                        write(() =>
                            recordPlanUsage(fiveHour).catch(e =>
                                ctx.sink.progress(`Could not save the plan's usage: ${(e as Error).message}`, "warn")
                            )
                        );
                        if (plan && !cfg.allowPastReserve && fiveHour.utilization > PLAN_RESERVE && !stop && !planLimit)
                            stop = {
                                status: "partial",
                                note: `Stopped: the Claude plan's 5-hour usage reached ${percent(fiveHour.utilization)}, above the ${percent(PLAN_RESERVE)} reserve; it resets ${clock(fiveHour.resetsAt)}. Re-run this aspect then, or allow it past the reserve.`
                            };
                    }
                    break;
                }
                case "result":
                    responses.abort();
                    await writes;
                    if (writeError) throw writeError;
                    if (ctx.state.fatal) throw ctx.state.fatal;
                    if (ctx.state.finished) return end("done", null);
                    if (stop) return end(stop.status, stop.note);
                    if (declined) return end("declined", `Not covered (declined, category ${declined}).`);
                    if (planLimit)
                        return end(
                            "partial",
                            `Partially covered: the Claude plan's ${WINDOW[planLimit.window] ?? planLimit.window} usage limit was reached${planLimit.resetsAt ? `; it resets ${clock(planLimit.resetsAt)}` : ""}. Re-run this aspect after that.`
                        );
                    if (apiError === "rate_limit")
                        return end("partial", "Partially covered: the API kept rate-limiting requests. Re-run this aspect later.");
                    if (m.subtype === "error_max_turns") return end("partial", "Partially covered: the turn limit was reached.");
                    if (m.is_error || m.subtype !== "success" || apiError)
                        return end(
                            "failed",
                            `Agent SDK error: ${apiError ?? m.subtype}${m.subtype === "success" ? ` (${m.result})` : m.errors.length ? ` (${m.errors.join("; ")})` : ""}.`
                        );
                    // A turn that ended without tools: the same check as after any other call.
                    stop = await check();
                    if (stop) return end(stop.status, stop.note);
                    if (reopen) {
                        reopen = false;
                        input.push(REOPEN);
                        break;
                    }
                    if (!nudged) {
                        nudged = true;
                        input.push(NUDGE);
                        break;
                    }
                    return end("partial", "Finished without reporting coverage.");
            }
        }
        await writes;
        return end("failed", `The Agent SDK ended without a result: ${stderr.join("").slice(-500)}`);
    } catch (e) {
        if (e === ctx.state.fatal || e === writeError) throw e;
        return end("failed", `Agent SDK: ${(e as Error).message}`);
    } finally {
        responses.abort();
        input.close();
        q.close();
    }
}

/** Per-call usage from the stream: message_start carries input and cache counts, message_delta the final ones. */
function callRecord(
    ctx: AgentContext,
    requested: string,
    start: { model: string; usage: BetaUsage },
    delta: BetaRawMessageDeltaEvent,
    fellBack: boolean
): CallRecord {
    const final = Object.fromEntries(Object.entries(delta.usage).filter(([, v]) => v !== null && v !== undefined));
    const msg = {
        model: start.model,
        usage: { ...start.usage, ...final },
        content: [],
        stop_reason: delta.delta.stop_reason,
        stop_details: delta.delta.stop_details ?? null
    } as unknown as BetaMessage;
    const priced = priceMessage(requested, msg);
    return {
        agentRunId: ctx.agentRunId,
        requestedModel: requested,
        servedModel: priced.servedModel,
        fallback: priced.fallback || fellBack,
        usage: priced.usage,
        costUsd: priced.costUsd,
        stopReason: delta.delta.stop_reason,
        refusalCategory: delta.delta.stop_details?.category ?? null
    };
}

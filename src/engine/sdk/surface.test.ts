// Pins what the bundled Claude Code binary does against the fake server, before the engine relies on it.
import { type Options, type SDKMessage, createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { message } from "@/engine/replay";
import { startConnectSpy } from "@/test/connect-spy";

import { type FakeReply, startFakeAnthropic } from "./fake-server";
import { InputQueue } from "./input";

let n = 0;
const ping = (text = "hi") =>
    message({
        content: [{ type: "tool_use", id: `toolu_p${++n}`, name: "ping", input: { text }, caller: null }],
        stop_reason: "tool_use"
    } as never);
const done = () => message({ content: [{ type: "text", text: "ok", citations: null }], stop_reason: "end_turn" } as never);
const assistantErrors = (out: SDKMessage[]) => out.flatMap(m => (m.type === "assistant" && m.error ? [m.error] : []));
const refusal = () =>
    message({
        content: [{ type: "tool_use", id: `toolu_r${++n}`, name: "ping", input: { text: "partial" }, caller: null }],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: null }
    } as never);

async function probe(
    messages: BetaMessage[],
    o: {
        credential: "plan" | "key" | "none";
        /** No ANTHROPIC_BASE_URL: the default host, through the refusing proxy. */
        direct?: boolean;
        endTurn?: boolean;
        hooks?: Options["hooks"];
        reply?: (n: number) => FakeReply | null;
        headers?: (n: number) => Record<string, string>;
    }
) {
    const fake = await startFakeAnthropic(messages, { toolPrefix: "mcp__probe__", reply: o.reply, headers: o.headers });
    const spy = await startConnectSpy();
    const dir = await mkdtemp(join(tmpdir(), "auditdesk-probe-"));
    const calls: string[] = [];
    const pingTool = tool("ping", "Answers pong.", { text: z.string() }, async ({ text }) => {
        calls.push(text);
        // The CLI reads the marker from a successful result's _meta, not from the tool's definition.
        return { content: [{ type: "text", text: "pong" }], ...(o.endTurn ? { _meta: { "claude/endTurn": true } } : {}) };
    });
    const input = new InputQueue();
    input.push("Call ping with the text hi.");
    const out: SDKMessage[] = [];
    const q = query({
        prompt: input,
        options: {
            model: "claude-sonnet-5-5",
            effort: "low",
            taskBudget: { total: 20_000 },
            maxTurns: 5,
            systemPrompt: ["You are a probe."],
            tools: [],
            allowedTools: ["mcp__probe__ping"],
            permissionMode: "dontAsk",
            permissionPrompts: "none",
            settingSources: [],
            strictMcpConfig: true,
            persistSession: false,
            includePartialMessages: true,
            verbatimPrompts: true,
            mcpServers: {
                probe: createSdkMcpServer({
                    name: "probe",
                    version: "1.0.0",
                    alwaysLoad: true,
                    tools: [pingTool]
                })
            },
            hooks: o.hooks,
            cwd: dir,
            env: {
                PATH: process.env.PATH ?? "",
                HOME: process.env.HOME ?? "",
                CLAUDE_CONFIG_DIR: join(dir, "config"),
                ...(o.direct ? {} : { ANTHROPIC_BASE_URL: fake.url }),
                ...(o.credential === "plan" ? { CLAUDE_CODE_OAUTH_TOKEN: "probe-token" } : {}),
                ...(o.credential === "key" ? { ANTHROPIC_API_KEY: "probe-key" } : {}),
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
                ENABLE_TOOL_SEARCH: "false",
                CLAUDE_CODE_MAX_RETRIES: "0",
                HTTPS_PROXY: spy.url,
                HTTP_PROXY: spy.url,
                NO_PROXY: "127.0.0.1,localhost"
            }
        }
    });
    // After an error result the iterator throws "Claude Code returned an error result: …" once the process exits.
    let error: string | null = null;
    try {
        for await (const m of q) {
            out.push(m);
            if (m.type === "result") input.close();
        }
    } catch (e) {
        error = (e as Error).message;
    } finally {
        input.close();
        q.close();
        await fake.close();
        await spy.close();
    }
    return { requests: fake.requests, unexpected: fake.unexpected, attempts: spy.attempts, out, calls, error };
}

describe("the bundled Claude Code against the fake server", { timeout: 60_000 }, () => {
    it("sends a plan token as a bearer token to ANTHROPIC_BASE_URL, and nothing else leaves the machine", async () => {
        const r = await probe([ping(), done()], { credential: "plan" });
        expect(r.requests[0].headers.authorization).toBe("Bearer probe-token");
        expect(r.requests[0].headers["x-api-key"]).toBeUndefined();
        expect(r.attempts).toEqual([]);
        expect(r.unexpected).toEqual([]);
    });

    it("the proxy's control: without a base URL the request goes to api.anthropic.com through the proxy, which refuses it", async () => {
        const r = await probe([done()], { credential: "key", direct: true });
        expect(r.attempts).toContain("CONNECT api.anthropic.com:443");
        expect(r.requests).toHaveLength(0);
        expect(r.error).toMatch(/ERR_PROXY_TUNNEL/);
    });

    it("with no credential in its environment, the isolated session sends no request: no Keychain login", async () => {
        const r = await probe([done()], { credential: "none" });
        expect(r.requests).toHaveLength(0);
        expect(assistantErrors(r.out)).toEqual(["authentication_failed"]);
        expect(r.error).toMatch(/Not logged in/);
    });

    it("stops before the next request when a PostToolBatch hook answers continue: false", async () => {
        let batches = 0;
        const r = await probe([ping(), done()], {
            credential: "plan",
            hooks: { PostToolBatch: [{ hooks: [async () => (batches++, { continue: false, stopReason: "budget" })] }] }
        });
        expect(r.calls).toEqual(["hi"]);
        expect(batches).toBe(1);
        expect(r.requests).toHaveLength(1);
    });

    it("runs a PostToolBatch hook once for two tool calls in one response", async () => {
        let batches = 0;
        const two = message({
            content: [
                { type: "tool_use", id: "toolu_a", name: "ping", input: { text: "a" }, caller: null },
                { type: "tool_use", id: "toolu_b", name: "ping", input: { text: "b" }, caller: null }
            ],
            stop_reason: "tool_use"
        } as never);
        const r = await probe([two, done()], { credential: "plan", hooks: { PostToolBatch: [{ hooks: [async () => (batches++, {})] }] } });
        expect(r.calls.sort()).toEqual(["a", "b"]);
        expect(batches).toBe(1);
    });

    it("sends an API key as x-api-key", async () => {
        const r = await probe([ping(), done()], { credential: "key" });
        expect(r.requests[0].headers["x-api-key"]).toBe("probe-key");
        expect(r.requests[0].headers.authorization).toBeUndefined();
    });

    it("sends the model, low effort, the task budget, the system prompt and only our tool, loaded", async () => {
        const r = await probe([ping(), done()], { credential: "plan" });
        for (const req of r.requests) {
            const body = req.body as {
                model: string;
                system: unknown;
                tools: { name: string; defer_loading?: boolean }[];
                output_config: { effort: string; task_budget: { total: number } };
            };
            expect(body.model).toBe("claude-sonnet-5-5");
            expect(body.output_config.effort).toBe("low");
            expect(body.output_config.task_budget.total).toBe(20_000);
            expect(JSON.stringify(body.system)).toContain("You are a probe.");
            expect(body.tools.map(t => t.name)).toEqual(["mcp__probe__ping"]);
            expect(body.tools.some(t => t.defer_loading)).toBe(false);
        }
    });

    it("runs the tool and sends its result on the next request", async () => {
        const r = await probe([ping(), done()], { credential: "plan" });
        expect(r.calls).toEqual(["hi"]);
        expect(JSON.stringify(r.requests[1].body)).toContain("pong");
    });

    it("ends the turn on a successful tool result marked claude/endTurn, without another request", async () => {
        const r = await probe([ping(), done()], { credential: "plan", endTurn: true });
        expect(r.calls).toEqual(["hi"]);
        expect(r.requests).toHaveLength(1);
    });

    it("reports the credential source in system/init", async () => {
        const plan = await probe([done()], { credential: "plan" });
        const key = await probe([done()], { credential: "key" });
        const init = (out: SDKMessage[]) =>
            out.find(m => m.type === "system" && m.subtype === "init") as { apiKeySource: string; tools: string[] };
        expect(init(plan.out).apiKeySource).toBe("none");
        expect(init(key.out).apiKeySource).toBe("ANTHROPIC_API_KEY");
        expect(init(plan.out).tools).toEqual(["mcp__probe__ping"]);
    });

    it("runs a refused response's tool call while it streams and reports it interrupted; retries once, then on Sonnet 5 only", async () => {
        const r = await probe([refusal(), refusal(), refusal(), done()], { credential: "plan" });
        // Streaming tool execution: the call started before the refusal arrived. E.5 gates the tools that write.
        expect(r.calls).toEqual(["partial", "partial", "partial"]);
        expect(JSON.stringify(r.requests[1].body)).toContain("stopped by a safety classifier while the call was running");
        expect(r.requests.map(q => (q.body as { model: string }).model)).toEqual([
            "claude-sonnet-5-5",
            "claude-sonnet-5-5",
            "claude-sonnet-5",
            "claude-sonnet-5"
        ]);
        const system = r.out.filter(m => m.type === "system") as { subtype: string; fallback_model?: string; content?: string }[];
        expect(system.find(m => m.subtype === "informational")?.content).toMatch(/continuing once/);
        // Design § 8: Sonnet 5.5's cyber declines go to Sonnet 5 (Andrii's OK of 2026-10-05).
        expect(system.filter(m => m.subtype === "model_refusal_fallback").map(m => m.fallback_model)).toEqual(["claude-sonnet-5"]);
        // No fallback left, yet the turn goes on: the refused response's tool results are sent back.
        expect(system.some(m => m.subtype === "model_refusal_no_fallback")).toBe(true);
    });

    it("surfaces a 429 without the plan's headers as server throttling, not the usage limit", async () => {
        const r = await probe([], {
            credential: "plan",
            reply: () => ({
                status: 429,
                headers: { "retry-after": "0", "x-should-retry": "false" },
                body: { type: "error", error: { type: "rate_limit_error", message: "usage limit" } }
            })
        });
        expect(assistantErrors(r.out)).toEqual(["rate_limit"]);
        expect(r.error).toMatch(/not your usage limit/);
        const events = r.out.filter(m => m.type === "rate_limit_event");
        expect(events.map(m => m.rate_limit_info.rateLimitType)).toEqual([undefined]);
    });

    it("reports the plan's usage limit as a rejected rate_limit_event of its window", async () => {
        const resets = Math.floor(Date.now() / 1000) + 3600;
        const r = await probe([], {
            credential: "plan",
            reply: () => ({
                status: 429,
                headers: {
                    "retry-after": "0",
                    "x-should-retry": "false",
                    "anthropic-ratelimit-unified-status": "rejected",
                    "anthropic-ratelimit-unified-representative-claim": "five_hour",
                    "anthropic-ratelimit-unified-reset": String(resets),
                    "anthropic-ratelimit-unified-5h-utilization": "1.0",
                    "anthropic-ratelimit-unified-5h-reset": String(resets)
                },
                body: { type: "error", error: { type: "rate_limit_error", message: "usage limit" } }
            })
        });
        expect(assistantErrors(r.out)).toEqual(["rate_limit"]);
        expect(r.error).toMatch(/hit your session limit/);
        const info = r.out.flatMap(m => (m.type === "rate_limit_event" ? [m.rate_limit_info] : []));
        expect(info).toMatchObject([{ status: "rejected", rateLimitType: "five_hour", resetsAt: resets }]);
    });

    it("reports the plan's 5-hour usage from the response headers at each whole-percent change, and none on an API key", async () => {
        const resets = Math.floor(Date.now() / 1000) + 3 * 3600;
        const headers = (u: number[]) => (n: number) => ({
            "anthropic-ratelimit-unified-status": "allowed",
            "anthropic-ratelimit-unified-representative-claim": "five_hour",
            "anthropic-ratelimit-unified-reset": String(resets),
            "anthropic-ratelimit-unified-5h-utilization": String(u[n - 1]),
            "anthropic-ratelimit-unified-5h-reset": String(resets)
        });
        const windows = (out: SDKMessage[]) =>
            out.flatMap(m =>
                m.type === "rate_limit_event"
                    ? [
                          (m.rate_limit_info as { unifiedWindows?: { five_hour?: { utilization: number; resetsAt: number } } })
                              .unifiedWindows?.five_hour
                      ]
                    : []
            );
        const plan = await probe([ping("a"), ping("b"), ping("c"), done()], {
            credential: "plan",
            headers: headers([0.23, 0.231, 0.55, 0.56])
        });
        // unifiedWindows is @internal in the d.ts: present in the stream, absent from the public type.
        expect(windows(plan.out)).toEqual([
            { utilization: 0.23, resetsAt: resets },
            { utilization: 0.55, resetsAt: resets },
            { utilization: 0.56, resetsAt: resets }
        ]);
        const key = await probe([ping("a"), done()], { credential: "key", headers: headers([0.23, 0.55]) });
        expect(windows(key.out)).toEqual([]);
    });
});

import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { message } from "@/engine/replay";
import { CHECKLIST, finding, finish, text, tool } from "@/test/agent-messages";
import { makeRepo } from "@/test/git-repo";
import { makeHostileRepo } from "@/test/hostile-repo";
import { SAMPLE_KEY } from "@/test/sample-repo";
import { type SdkHarness, sdkHarness } from "@/test/sdk";

import { NUDGE, REOPEN } from "../agent/run-aspect";
import { Masker } from "../masker";
import { MemorySink } from "../memory-sink";
import { SYSTEM_PROMPT, prefixBlocks } from "../prompts";

import type { FakeReply } from "./fake-server";
import { type SdkRunnerConfig, runAspectSdk } from "./run-aspect-sdk";
import { sdkToolName } from "./tools";

const harnesses: SdkHarness[] = [];
afterEach(async () => {
    for (const h of harnesses) expect(h.spy.attempts).toEqual([]);
    await Promise.all(harnesses.splice(0).map(h => h.close()));
});

async function setup(
    responses: BetaMessage[],
    o: {
        share?: { usd: number; tokens: number };
        secrets?: string[];
        clone?: string;
        reply?: (n: number) => FakeReply | null;
        keepModel?: (n: number) => boolean;
        override?: SdkRunnerConfig["override"];
        sink?: MemorySink;
    } = {}
) {
    const h = await sdkHarness(responses, { reply: o.reply, keepModel: o.keepModel });
    harnesses.push(h);
    const clonePath =
        o.clone ??
        (await makeRepo({ "src/db.js": `const key = "${SAMPLE_KEY}";\ndb.query("SELECT * FROM u WHERE id=" + req.query.id);\n` }));
    const sink = o.sink ?? new MemorySink();
    const ctx = {
        clonePath,
        repositoryId: "r",
        agentRunId: "a1",
        aspect: "security",
        checklist: CHECKLIST,
        masker: new Masker((o.secrets ?? []).map(value => ({ value, rule: "generic-api-key" }))),
        repoMap: "map",
        sink,
        state: { finished: null, reported: [], fatal: null }
    };
    const run = () =>
        runAspectSdk(
            { ...h.config(), override: o.override },
            {
                model: "claude-sonnet-5-5",
                effort: "low",
                share: o.share ?? { usd: 10, tokens: 1_000_000 },
                ctx,
                system: prefixBlocks({ stackProfile: "s", repoMap: "map", brief: "b" }),
                firstMessage: "Audit security."
            }
        );
    return { sink, h, ctx, run };
}

const body = (h: SdkHarness, i: number) => JSON.stringify(h.fake.requests[i].body);

describe("runAspectSdk", { timeout: 60_000 }, () => {
    it("files a finding with its snippet and finishes, every call recorded and priced", async () => {
        const { sink, run } = await setup([
            tool("read_file", { path: "src/db.js", start_line: 1, end_line: 2 }),
            tool("report_finding", finding()),
            finish()
        ]);
        const out = await run();
        expect(out.status).toBe("done");
        expect(out.coverage).toContainEqual({ item: "SEC-04", status: "examined" });
        expect(sink.findings).toHaveLength(1);
        expect(sink.findings[0].evidence[0].snippet).toContain("SELECT * FROM u");
        expect(sink.calls).toHaveLength(3);
        expect(sink.calls.every(c => c.costUsd !== null && c.costUsd > 0)).toBe(true);
    });

    it("sends the default model at low effort, the share as task budget and exactly our seven tools, none deferred", async () => {
        const { h, run } = await setup([finish()], { share: { usd: 10, tokens: 50_000 } });
        await run();
        const req = h.fake.requests[0].body as {
            model: string;
            system: unknown;
            tools: { name: string; defer_loading?: boolean }[];
            output_config: { effort: string; task_budget: { total: number } };
        };
        expect(req.model).toBe("claude-sonnet-5-5");
        expect(req.output_config).toMatchObject({ effort: "low", task_budget: { total: 50_000 } });
        expect(JSON.stringify(req.system)).toContain(SYSTEM_PROMPT.slice(0, 60));
        expect(req.tools.map(t => t.name).sort()).toEqual(
            ["list_files", "read_file", "grep", "repo_map", "scanner_results", "report_finding", "finish_aspect"].map(sdkToolName).sort()
        );
        expect(req.tools.some(t => t.defer_loading)).toBe(false);
    });

    it("never lets a secret gitleaks found reach the model", async () => {
        const { h, run } = await setup([tool("read_file", { path: "src/db.js", start_line: 1, end_line: 2 }), finish()], {
            secrets: [SAMPLE_KEY]
        });
        await run();
        expect(body(h, 1)).not.toContain(SAMPLE_KEY);
    });

    it("asks once more when the model ends without finish_aspect, then reports partial", async () => {
        const { h, run } = await setup([text("I looked around."), text("Still looking.")]);
        const out = await run();
        expect(out).toMatchObject({ status: "partial", note: "Finished without reporting coverage." });
        expect(h.fake.requests).toHaveLength(2);
        expect(body(h, 1)).toContain(NUDGE);
    });

    it("gives a tool error back to the model as an error result", async () => {
        const { h, run } = await setup([tool("read_file", { path: "../../etc/passwd", start_line: 1, end_line: 1 }), finish()]);
        expect((await run()).status).toBe("done");
        expect(body(h, 1)).toMatch(/"is_error":true/);
    });

    it("reopens finish_aspect when a call beside it failed", async () => {
        const both = message({
            content: [
                { type: "tool_use", id: "toolu_bad", name: "report_finding", input: finding({ checklist_item: "SEC-99" }), caller: null },
                { type: "tool_use", id: "toolu_fin", name: "finish_aspect", input: { summary: "Done.", coverage: [] }, caller: null }
            ],
            stop_reason: "tool_use"
        } as never);
        const { h, sink, run } = await setup([both, tool("report_finding", finding()), finish()]);
        expect((await run()).status).toBe("done");
        expect(h.fake.requests.map((_, i) => body(h, i)).some(b => b.includes(REOPEN))).toBe(true);
        expect(sink.findings).toHaveLength(1);
    });

    it("stops on its budget share after the turn's tools ran, keeping the finding filed in it", async () => {
        const { h, sink, run } = await setup([tool("report_finding", finding()), finish()], {
            share: { usd: 0.000001, tokens: 1_000_000 }
        });
        expect(await run()).toMatchObject({ status: "partial", note: "Partially covered: the budget share was spent." });
        expect(sink.findings).toHaveLength(1);
        expect(h.fake.requests).toHaveLength(1);
    });

    // The database sink is slower than the stream: the checks after a turn must wait for its writes.
    it("stops on its budget share with a slow sink too, after exactly one request", async () => {
        class SlowSink extends MemorySink {
            override async recordCall(call: Parameters<MemorySink["recordCall"]>[0]) {
                await new Promise(r => setTimeout(r, 150));
                await super.recordCall(call);
            }
        }
        const { h, sink, run } = await setup([tool("report_finding", finding()), finish()], {
            share: { usd: 0.000001, tokens: 1_000_000 },
            sink: new SlowSink()
        });
        expect(await run()).toMatchObject({ status: "partial", note: "Partially covered: the budget share was spent." });
        expect(sink.findings).toHaveLength(1);
        expect(h.fake.requests).toHaveLength(1);
    });

    it("stops when the auditor asks", async () => {
        const { sink, run } = await setup([tool("read_file", { path: "src/db.js", start_line: 1, end_line: 1 }), finish()]);
        sink.stop = true;
        expect((await run()).status).toBe("stopped");
    });

    it("ends as declined on a refusal, and runs no tool call from the refused response", async () => {
        const refused = () =>
            message({
                content: [{ type: "tool_use", id: `toolu_r${Math.random()}`, name: "report_finding", input: finding(), caller: null }],
                stop_reason: "refusal",
                stop_details: { type: "refusal", category: "cyber", explanation: null }
            } as never);
        const { h, sink, run } = await setup([refused(), refused(), refused()]);
        const out = await run();
        expect(out.status).toBe("declined");
        expect(out.note).toContain("cyber");
        expect(sink.findings).toHaveLength(0);
        // The CLI retries once, falls back to Sonnet 5, and gives up there (Task E.1, Deviation 5): no fourth request.
        expect(h.fake.requests.map(r => (r.body as { model: string }).model)).toEqual([
            "claude-sonnet-5-5",
            "claude-sonnet-5-5",
            "claude-sonnet-5"
        ]);
    });

    it("never files a finding from a declined response, though the CLI starts its calls while it streams", async () => {
        const refused = message({
            content: [{ type: "tool_use", id: "toolu_declined", name: "report_finding", input: finding(), caller: null }],
            stop_reason: "refusal",
            stop_details: { type: "refusal", category: "cyber", explanation: null }
        } as never);
        const { sink, run } = await setup([refused, finish()]);
        expect((await run()).status).toBe("done");
        expect(sink.findings).toHaveLength(0);
    });

    it("stops after one call served by a model the run did not approve", async () => {
        const { h, run } = await setup(
            [message({ ...tool("read_file", { path: "src/db.js", start_line: 1, end_line: 1 }), model: "claude-opus-5-5" }), finish()],
            { keepModel: n => n === 1 }
        );
        expect(await run()).toMatchObject({
            status: "partial",
            note: expect.stringContaining("claude-opus-5-5, which this run did not approve")
        });
        expect(h.fake.requests).toHaveLength(1);
    });

    it("accepts a call served by the approved fallback, priced by that model", async () => {
        const { sink, run } = await setup([message({ ...finish(), model: "claude-sonnet-5" })], { keepModel: () => true });
        expect((await run()).status).toBe("done");
        expect(sink.calls[0]).toMatchObject({ servedModel: "claude-sonnet-5" });
        expect(sink.calls[0].costUsd).toBeGreaterThan(0);
    });

    it("ends the aspect as partial at the plan's usage limit", async () => {
        const resets = String(Math.floor(Date.now() / 1000) + 3600);
        const limit: FakeReply = {
            status: 429,
            headers: {
                "retry-after": "0",
                "x-should-retry": "false",
                "anthropic-ratelimit-unified-status": "rejected",
                "anthropic-ratelimit-unified-representative-claim": "five_hour",
                "anthropic-ratelimit-unified-reset": resets,
                "anthropic-ratelimit-unified-5h-utilization": "1.0",
                "anthropic-ratelimit-unified-5h-reset": resets
            },
            body: { type: "error", error: { type: "rate_limit_error", message: "usage limit" } }
        };
        const { run } = await setup([], { reply: () => limit });
        expect(await run()).toMatchObject({ status: "partial", note: expect.stringContaining("5-hour usage limit") });
    });

    // Without the plan's headers a 429 is the server throttling, not the plan's limit (Task E.1, Deviation 6).
    it("ends the aspect as partial when the API keeps throttling", async () => {
        const throttled: FakeReply = {
            status: 429,
            headers: { "retry-after": "0", "x-should-retry": "false" },
            body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } }
        };
        const { run } = await setup([], { reply: () => throttled });
        expect(await run()).toMatchObject({ status: "partial", note: expect.stringContaining("rate-limiting") });
    });

    it("fails with the reason on an authentication error", async () => {
        const { run } = await setup([], {
            reply: () => ({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid token" } } })
        });
        const out = await run();
        expect(out.status).toBe("failed");
        expect(out.note).toMatch(/authentication/);
    });

    it("runs nothing from the client's .claude, CLAUDE.md, .mcp.json or skills", async () => {
        const marker = join(await mkdtemp(join(tmpdir(), "auditdesk-marker-")), "ran");
        const { h, run } = await setup([tool("read_file", { path: "CLAUDE.md", start_line: 1, end_line: 1 }), finish()], {
            clone: await makeHostileRepo(marker)
        });
        expect((await run()).status).toBe("done");
        expect(existsSync(marker)).toBe(false);
        // read_file returns CLAUDE.md as data: the canary may appear once, in that tool result, and nowhere before it.
        expect(body(h, 0)).not.toContain("CANARY");
        expect(h.fake.requests.every(r => (r.body as { tools: unknown[] }).tools.length === 7)).toBe(true);
    });

    it("the control: with the clone as cwd and project settings loaded, its hook runs and its CLAUDE.md reaches the prompt", async () => {
        const marker = join(await mkdtemp(join(tmpdir(), "auditdesk-marker-")), "ran");
        const clone = await makeHostileRepo(marker);
        const { h, run } = await setup([finish()], {
            clone,
            override: { cwd: clone, settingSources: ["project"], verbatimPrompts: false }
        });
        await run();
        expect(existsSync(marker)).toBe(true);
        expect(body(h, 0)).toContain("CANARY-CLAUDE-MD");
    });

    it("fails closed when the session holds a tool it should not", async () => {
        const { sink, run } = await setup([finish()], { override: { tools: ["Read"] } });
        const out = await run();
        expect(out.status).toBe("failed");
        expect(out.note).toMatch(/Isolation check failed/);
        expect(sink.findings).toHaveLength(0);
    });
});

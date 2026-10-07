import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";

import { message, replayFetch } from "@/engine/replay";
import { CHECKLIST, finding, finish, text, tool } from "@/test/agent-messages";
import { makeRepo } from "@/test/git-repo";
import { SAMPLE_KEY } from "@/test/sample-repo";

import { ASPECTS } from "../aspects";
import { type Checklist, loadChecklist, parseChecklist } from "../checklists";
import { Masker } from "../masker";
import { MemorySink } from "../memory-sink";
import { prefixBlocks } from "../prompts";

import { runAspect } from "./run-aspect";

async function setup(
    responses: BetaMessage[],
    o: {
        share?: { usd: number; tokens: number };
        secrets?: string[];
        files?: Record<string, string>;
        checklist?: Checklist;
        aspect?: string;
    } = {}
) {
    const clonePath = await makeRepo({
        "src/db.js": `const key = "${SAMPLE_KEY}";\ndb.query("SELECT * FROM u WHERE id=" + req.query.id);\n`,
        ...o.files
    });
    const sink = new MemorySink();
    const { fetch, requests } = replayFetch(responses);
    const ctx = {
        clonePath,
        repositoryId: "r",
        agentRunId: "a1",
        aspect: o.aspect ?? "security",
        checklist: o.checklist ?? CHECKLIST,
        masker: new Masker((o.secrets ?? []).map(value => ({ value, rule: "generic-api-key" }))),
        repoMap: "map",
        sink,
        state: { finished: null, reported: [], fatal: null }
    };
    const run = () =>
        runAspect({
            client: new Anthropic({ apiKey: "test", fetch, maxRetries: 0 }),
            model: "claude-opus-5-5",
            effort: "medium",
            share: o.share ?? { usd: 10, tokens: 1_000_000 },
            ctx,
            system: prefixBlocks({ stackProfile: "s", repoMap: "map", brief: "b" }),
            firstMessage: "Audit security."
        });
    return { sink, requests, run };
}

describe("runAspect", () => {
    it("files a finding with its snippet read from the file, then finishes with full coverage", async () => {
        const { sink, requests, run } = await setup([
            tool("read_file", { path: "src/db.js", start_line: 1, end_line: 2 }),
            tool("report_finding", finding()),
            finish()
        ]);
        const outcome = await run();
        expect(outcome.status).toBe("done");
        expect(outcome.coverage).toEqual([
            { item: "SEC-01", status: "not_examined" },
            { item: "SEC-04", status: "examined" }
        ]);
        expect(sink.findings).toHaveLength(1);
        expect(sink.findings[0].evidence[0].snippet).toContain("SELECT * FROM u");
        expect(sink.calls).toHaveLength(3);
        expect(requests).toHaveLength(3);
    });

    it("tags a finding filed under an AI-built item ai-built", async () => {
        const checklist = parseChecklist("security", "# Security\n\n## SEC-01 Authentication\n\n## SEC-02 Missing checks (AI-built)\n");
        const { sink, run } = await setup([tool("report_finding", finding({ checklist_item: "SEC-02", tags: ["auth"] })), finish()], {
            checklist
        });
        await run();
        expect(sink.findings[0].tags).toEqual(["auth", "ai-built"]);
    });

    it("returns bad evidence to the model as an error it can correct", async () => {
        const { sink, requests, run } = await setup([
            tool("report_finding", finding({ evidence: [{ file: "../outside.js", start_line: 1, end_line: 1 }] })),
            tool("report_finding", finding()),
            finish()
        ]);
        await run();
        expect(JSON.stringify(requests[1].body.messages)).toMatch(/leaves the repository/);
        expect(sink.findings).toHaveLength(1);
    });

    it("returns evidence that names a directory to the model, instead of failing the run", async () => {
        const { sink, requests, run } = await setup([
            tool("report_finding", finding({ evidence: [{ file: "src", start_line: 1, end_line: 1 }] })),
            tool("report_finding", finding()),
            finish()
        ]);
        expect((await run()).status).toBe("done");
        expect(JSON.stringify(requests[1].body.messages)).toMatch(/src is a directory or unreadable/);
        expect(sink.findings).toHaveLength(1);
    });

    it("caps each line of a finding's snippet, as read_file does", async () => {
        const { sink, run } = await setup(
            [tool("report_finding", finding({ evidence: [{ file: "dist/app.min.js", start_line: 1, end_line: 1 }] })), finish()],
            { files: { "dist/app.min.js": `${"z".repeat(50_000)}\n` } }
        );
        await run();
        expect(sink.findings[0].evidence[0].snippet!.length).toBeLessThan(2100);
    });

    it("files a question without a severity, whatever the model sent", async () => {
        const { sink, run } = await setup([
            tool("report_finding", finding({ kind: "question", severity: "high", evidence: [] })),
            finish()
        ]);
        await run();
        expect(sink.findings[0]).toMatchObject({ kind: "question", severity: null });
    });

    it("asks for finish_aspect once only, and ends partial when the model still does not call it", async () => {
        const { requests, run } = await setup([text("I looked around."), text("Still looking.")]);
        expect(await run()).toMatchObject({ status: "partial", note: expect.stringMatching(/without reporting coverage/) });
        expect(requests).toHaveLength(2);
    });

    it("masks secrets in tool results before they enter the conversation", async () => {
        const { requests, run } = await setup([tool("read_file", { path: "src/db.js", start_line: 1, end_line: 2 }), finish()], {
            secrets: [SAMPLE_KEY]
        });
        await run();
        expect(JSON.stringify(requests[1].body)).not.toContain(SAMPLE_KEY);
    });

    it("masks a secret that a cut line or a grep excerpt would split", async () => {
        const minified = `${"x".repeat(1995)}${SAMPLE_KEY};\n${"y".repeat(290)}${SAMPLE_KEY};\n`;
        const { requests, run } = await setup(
            [
                tool("read_file", { path: "dist/app.min.js", start_line: 1, end_line: 1 }),
                tool("grep", { pattern: "y{290}", glob: "" }),
                finish()
            ],
            { secrets: [SAMPLE_KEY], files: { "dist/app.min.js": minified } }
        );
        await run();
        const sent = JSON.stringify(requests.slice(1).map(r => r.body.messages));
        expect(sent).not.toContain(SAMPLE_KEY.slice(0, 5));
    });

    it("reopens the aspect when a call beside finish_aspect failed, so the model can fix it", async () => {
        const both = message({
            content: [
                {
                    type: "tool_use",
                    id: "toolu_bad",
                    name: "report_finding",
                    input: finding({ evidence: [{ file: "src/db.js", start_line: 1, end_line: 9 }] }),
                    caller: null
                },
                {
                    type: "tool_use",
                    id: "toolu_fin",
                    name: "finish_aspect",
                    input: { summary: "Done.", coverage: [{ item: "SEC-04", status: "examined" }] },
                    caller: null
                }
            ],
            stop_reason: "tool_use"
        } as never);
        const { sink, requests, run } = await setup([both, tool("report_finding", finding()), finish()]);
        expect((await run()).status).toBe("done");
        expect(sink.findings).toHaveLength(1);
        expect(requests).toHaveLength(3);
        const results = JSON.stringify((requests[1].body.messages as { content: unknown }[]).at(-1));
        expect(results).toMatch(/not a valid range/);
        expect(results).toMatch(/Not finished: another call in this turn failed/);
    });

    it("neither runs nor echoes the declined model's calls before a fallback", async () => {
        const rescued = message({
            content: [
                { type: "thinking", thinking: "Declined note.", signature: "sig-declined" },
                { type: "tool_use", id: "toolu_declined", name: "report_finding", input: finding(), caller: null },
                { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } },
                { type: "tool_use", id: "toolu_rescued", name: "list_files", input: { dir: ".", glob: "" }, caller: null }
            ],
            stop_reason: "tool_use"
        } as never);
        const { sink, requests, run } = await setup([rescued, finish()]);
        await run();
        expect(sink.findings).toHaveLength(0);
        const echoed = JSON.stringify(
            (requests[1].body.messages as { role: string; content: unknown }[]).filter(m => m.role === "assistant")
        );
        expect(echoed).not.toContain("toolu_declined");
        expect(echoed).not.toContain("sig-declined");
        expect(echoed).toContain("toolu_rescued");
    });

    it("marks the aspect declined after a refusal the fallback did not rescue, and runs none of its tools", async () => {
        const refused = message({
            content: [],
            stop_reason: "refusal",
            stop_details: { type: "refusal", category: "cyber", explanation: null }
        } as never);
        const { sink, run } = await setup([refused]);
        const outcome = await run();
        expect(outcome).toMatchObject({ status: "declined" });
        expect(outcome.note).toMatch(/cyber/);
        expect(sink.findings).toHaveLength(0);
    });

    it("stops when a call cannot be priced", async () => {
        const { run } = await setup([tool("list_files", { dir: ".", glob: "" }, { model: "claude-unknown" })]);
        expect(await run()).toMatchObject({ status: "partial", note: expect.stringMatching(/budget unknown/) });
    });

    it("stops at the budget share and keeps the finding filed in the last turn", async () => {
        const { sink, requests, run } = await setup([tool("report_finding", finding()), finish()], { share: { usd: 10, tokens: 500 } });
        const outcome = await run();
        expect(outcome).toMatchObject({ status: "partial", note: expect.stringMatching(/budget share/) });
        expect(sink.findings).toHaveLength(1);
        expect(requests).toHaveLength(1);
    });

    it("says coverage was not reported when the agent stopped before finish_aspect", async () => {
        const { run } = await setup([tool("report_finding", finding()), finish()], { share: { usd: 10, tokens: 500 } });
        expect((await run()).coverage.map(c => c.status)).toEqual(["not_reported", "not_reported"]);
    });

    it("stops when Andrii presses Stop", async () => {
        const { sink, requests, run } = await setup([tool("list_files", { dir: ".", glob: "" }), finish()]);
        sink.stop = true;
        expect((await run()).status).toBe("stopped");
        expect(requests).toHaveLength(1);
    });

    it("asks once for finish_aspect when the model ends without it", async () => {
        const { requests, run } = await setup([text("I looked around."), finish()]);
        expect((await run()).status).toBe("done");
        const last = (requests[1].body.messages as { role: string; content: unknown }[]).at(-1)!;
        expect(JSON.stringify(last)).toMatch(/finish_aspect/);
    });

    it("shows the model's progress notes", async () => {
        const note = message({
            content: [
                { type: "thinking", thinking: "Reading the login route next.", signature: "sig" },
                { type: "tool_use", id: "toolu_note", name: "list_files", input: { dir: ".", glob: "" }, caller: null }
            ],
            stop_reason: "tool_use"
        } as never);
        const { sink, run } = await setup([note, finish()]);
        await run();
        expect(sink.events).toContain("Security: Reading the login route next.");
    });

    // Tasks 3.5–3.11: every aspect of the catalogue files a finding under its own items and reports coverage.
    it.each(ASPECTS.map(a => a.key))("runs the %s aspect: files a finding under its first item and reports full coverage", async aspect => {
        const checklist = await loadChecklist(aspect);
        const first = checklist.items[0].id;
        const { sink, run } = await setup(
            [
                tool("report_finding", finding({ checklist_item: first })),
                tool("finish_aspect", { summary: "ok", coverage: checklist.items.map(i => ({ item: i.id, status: "examined" })) })
            ],
            { aspect, checklist }
        );
        const outcome = await run();
        expect(outcome.status).toBe("done");
        expect(sink.findings.map(f => [f.aspect, f.checklistItem])).toEqual([[aspect, first]]);
        expect(outcome.coverage.every(c => c.status === "examined")).toBe(true);
        expect(outcome.coverage).toHaveLength(checklist.items.length);
    });

    it("drops an ai-built tag the model puts on an item that is not marked AI-built", async () => {
        const checklist = parseChecklist("security", "# Security\n\n## SEC-01 Authentication\n\n## SEC-02 Missing checks (AI-built)\n");
        const { sink, run } = await setup(
            [tool("report_finding", finding({ checklist_item: "SEC-01", tags: ["ai-built", "auth"] })), finish()],
            {
                checklist
            }
        );
        await run();
        expect(sink.findings[0].tags).toEqual(["auth"]);
    });
});

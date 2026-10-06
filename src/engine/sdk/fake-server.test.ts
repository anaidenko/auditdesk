import { afterEach, describe, expect, it } from "vitest";

import { message } from "@/engine/replay";

import { type FakeAnthropic, startFakeAnthropic } from "./fake-server";

const servers: FakeAnthropic[] = [];
afterEach(async () => void (await Promise.all(servers.splice(0).map(s => s.close()))));

const toolUse = () =>
    message({
        content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a" }, caller: null }],
        stop_reason: "tool_use"
    } as never);

describe("startFakeAnthropic", () => {
    it("streams the next recorded message for each request and logs the request", async () => {
        const fake = await startFakeAnthropic([toolUse()], { toolPrefix: "mcp__auditdesk__" });
        servers.push(fake);
        const res = await fetch(`${fake.url}/v1/messages?beta=true`, { method: "POST", body: JSON.stringify({ model: "m" }) });
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        expect(await res.text()).toContain('"name":"mcp__auditdesk__read_file"');
        expect(fake.requests[0].body).toEqual({ model: "m" });
    });

    it("answers anything else with 404 and records it", async () => {
        const fake = await startFakeAnthropic([]);
        servers.push(fake);
        expect((await fetch(`${fake.url}/v1/messages/count_tokens`, { method: "POST" })).status).toBe(404);
        expect(fake.unexpected).toEqual(["POST /v1/messages/count_tokens"]);
    });

    it("answers with a non-retryable error when the recording runs out", async () => {
        const fake = await startFakeAnthropic([]);
        servers.push(fake);
        const res = await fetch(`${fake.url}/v1/messages`, { method: "POST", body: "{}" });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("no recorded message left for request 1");
    });

    it("answers as the requested model, as the API does without a fallback, unless told to keep the recorded one", async () => {
        const recorded = message({ content: [], stop_reason: "end_turn", model: "claude-opus-5-5" } as never);
        const fake = await startFakeAnthropic([recorded, recorded], { keepModel: n => n === 2 });
        servers.push(fake);
        const ask = () =>
            fetch(`${fake.url}/v1/messages`, { method: "POST", body: JSON.stringify({ model: "claude-sonnet-5-5" }) }).then(r => r.text());
        expect(await ask()).toContain('"model":"claude-sonnet-5-5"');
        expect(await ask()).toContain('"model":"claude-opus-5-5"');
    });

    it("adds a test's headers to a streamed reply, as the API sends its rate-limit headers", async () => {
        const recorded = message({ content: [], stop_reason: "end_turn" } as never);
        const fake = await startFakeAnthropic([recorded], {
            headers: n => ({ "anthropic-ratelimit-unified-5h-utilization": String(n / 10) })
        });
        servers.push(fake);
        const res = await fetch(`${fake.url}/v1/messages`, { method: "POST", body: "{}" });
        expect(res.headers.get("anthropic-ratelimit-unified-5h-utilization")).toBe("0.1");
        expect(res.headers.get("content-type")).toBe("text/event-stream");
    });

    it("answers a request with stream: false with the message as JSON, as the API does", async () => {
        const fake = await startFakeAnthropic([toolUse()], { toolPrefix: "mcp__auditdesk__" });
        servers.push(fake);
        const res = await fetch(`${fake.url}/v1/messages`, { method: "POST", body: JSON.stringify({ model: "m", stream: false }) });
        expect(res.headers.get("content-type")).toBe("application/json");
        const m = (await res.json()) as { model: string; content: { name: string }[] };
        expect(m.model).toBe("m");
        expect(m.content[0].name).toBe("mcp__auditdesk__read_file");
    });

    it("lets a test answer with a raw body, such as an event stream without events", async () => {
        const fake = await startFakeAnthropic([], {
            reply: () => ({ status: 200, headers: { "content-type": "text/event-stream" }, raw: "" })
        });
        servers.push(fake);
        const res = await fetch(`${fake.url}/v1/messages`, { method: "POST", body: "{}" });
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        expect(await res.text()).toBe("");
    });

    it("lets a test answer one request with its own status", async () => {
        const fake = await startFakeAnthropic([], {
            reply: n => (n === 1 ? { status: 429, headers: { "x-should-retry": "false" } } : null)
        });
        servers.push(fake);
        const res = await fetch(`${fake.url}/v1/messages`, { method: "POST", body: "{}" });
        expect(res.status).toBe(429);
        expect(res.headers.get("x-should-retry")).toBe("false");
    });
});

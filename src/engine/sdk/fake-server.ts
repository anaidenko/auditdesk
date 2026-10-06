import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { type CapturedRequest, messageToSse } from "../replay";

export interface FakeReply {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
    /** Sent as is in place of the JSON body: an event stream without events, for one. */
    raw?: string;
}

export interface FakeAnthropic {
    url: string;
    /** Every POST to /v1/messages, in order. */
    requests: CapturedRequest[];
    /** Any other method or path; a test asserts it stays empty. */
    unexpected: string[];
    close(): Promise<void>;
}

const json = { "content-type": "application/json" };
const error = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message } });

/**
 * The Messages API on 127.0.0.1 for the Agent SDK's subprocess (ANTHROPIC_BASE_URL). Each request
 * gets the next recorded message as an event stream, serialised as `replayFetch` does. Recordings
 * name tools bare (`read_file`); the SDK serves them as `mcp__auditdesk__read_file`, so
 * `toolPrefix` renames them on the way out. A message is served as the model the request named,
 * as the API does without a fallback; `keepModel` keeps the recorded one for the requests a test
 * names (a fallback, an unpriced model). `headers` adds response headers, such as the plan's
 * rate-limit headers, to a streamed reply.
 */
export async function startFakeAnthropic(
    messages: BetaMessage[],
    o: {
        toolPrefix?: string;
        reply?: (n: number) => FakeReply | null;
        keepModel?: (n: number) => boolean;
        headers?: (n: number) => Record<string, string>;
    } = {}
): Promise<FakeAnthropic> {
    const queue = [...messages];
    const requests: CapturedRequest[] = [];
    const unexpected: string[] = [];
    const server = createServer(async (req, res) => {
        if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/v1/messages") {
            unexpected.push(`${req.method} ${req.url}`);
            res.writeHead(404, json).end(error("not_found_error", "Not served by the fake server."));
            return;
        }
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
        const body = raw ? (JSON.parse(raw) as { model?: string; stream?: boolean }) : {};
        requests.push({ url: req.url ?? "", headers, body });
        const own = o.reply?.(requests.length);
        if (own) {
            res.writeHead(own.status, { ...json, ...own.headers }).end(own.raw ?? JSON.stringify(own.body ?? {}));
            return;
        }
        const next = queue.shift();
        if (!next) {
            // 400, not 500: Claude Code retries a 5xx up to ten times.
            res.writeHead(400, json).end(
                error("invalid_request_error", `fake server: no recorded message left for request ${requests.length}`)
            );
            return;
        }
        const kept = o.keepModel?.(requests.length) || !body.model ? next : ({ ...next, model: body.model } as BetaMessage);
        const served = o.toolPrefix ? withPrefix(kept, o.toolPrefix) : kept;
        // Claude Code falls back to a non-streaming request when a stream fails (Task E.8, the review's Critical 1).
        const streamed = body.stream !== false;
        res.writeHead(200, {
            ...o.headers?.(requests.length),
            "content-type": streamed ? "text/event-stream" : "application/json",
            "request-id": `req_fake_${requests.length}`
        });
        res.end(streamed ? messageToSse(served) : JSON.stringify(served));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}`,
        requests,
        unexpected,
        close: () =>
            new Promise<void>(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            })
    };
}

function withPrefix(m: BetaMessage, prefix: string): BetaMessage {
    return { ...m, content: m.content.map(b => (b.type === "tool_use" ? { ...b, name: prefix + b.name } : b)) } as BetaMessage;
}

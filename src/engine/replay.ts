import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export interface CapturedRequest {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
}

let counter = 0;

export function message(partial: Partial<BetaMessage> & Pick<BetaMessage, "content" | "stop_reason">): BetaMessage {
    counter += 1;
    return {
        id: `msg_test_${counter}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        stop_sequence: null,
        stop_details: null,
        container: null,
        context_management: null,
        usage: usage({ input_tokens: 1000, output_tokens: 200 }),
        ...partial
    } as BetaMessage;
}

export function usage(u: Partial<BetaMessage["usage"]>): BetaMessage["usage"] {
    return {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: u.cache_creation_input_tokens ?? 0, ephemeral_1h_input_tokens: 0 },
        iterations: null,
        server_tool_use: null,
        service_tier: null,
        inference_geo: null,
        fallback_credit: null,
        output_tokens_details: null,
        ...u
    } as BetaMessage["usage"];
}

function sse(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Serialises a complete message as the Messages API streams it. */
export function messageToSse(m: BetaMessage): string {
    let out = sse("message_start", { type: "message_start", message: { ...m, content: [], stop_reason: null, stop_details: null } });
    m.content.forEach((block, index) => {
        if (block.type === "text") {
            out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
            out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
        } else if (block.type === "tool_use") {
            out += sse("content_block_start", { type: "content_block_start", index, content_block: { ...block, input: {} } });
            out += sse("content_block_delta", {
                type: "content_block_delta",
                index,
                delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
            });
        } else if (block.type === "thinking") {
            out += sse("content_block_start", {
                type: "content_block_start",
                index,
                content_block: { type: "thinking", thinking: "", signature: "" }
            });
            out += sse("content_block_delta", {
                type: "content_block_delta",
                index,
                delta: { type: "thinking_delta", thinking: block.thinking }
            });
            out += sse("content_block_delta", {
                type: "content_block_delta",
                index,
                delta: { type: "signature_delta", signature: block.signature }
            });
        } else {
            out += sse("content_block_start", { type: "content_block_start", index, content_block: block });
        }
        out += sse("content_block_stop", { type: "content_block_stop", index });
    });
    out += sse("message_delta", {
        type: "message_delta",
        delta: { stop_reason: m.stop_reason, stop_sequence: null, stop_details: m.stop_details },
        usage: m.usage
    });
    out += sse("message_stop", { type: "message_stop" });
    return out;
}

/** One agent's recorded messages, or one list per aspect, keyed by its checklist's title. */
export type Recording = BetaMessage[] | Record<string, BetaMessage[]>;

/** The text of a request's first message, where the aspect's checklist starts with "# Aspect: <title>". */
function firstText(body: unknown): string {
    const content = (body as { messages?: { content?: unknown }[] } | null)?.messages?.[0]?.content;
    if (typeof content === "string") return content;
    return Array.isArray(content)
        ? content.map(b => ((b as { type?: string }).type === "text" ? (b as { text: string }).text : "")).join("\n")
        : "";
}

/**
 * Takes the next recorded message for a request. A keyed recording serves each aspect's agent from
 * its own list, so one replayed run can start several agents.
 */
export function recordedQueue(recording: Recording): (body: unknown) => { message?: BetaMessage; missing?: string } {
    if (Array.isArray(recording)) {
        const queue = [...recording];
        return () => {
            const message = queue.shift();
            return message ? { message } : { missing: "no recorded message left" };
        };
    }
    const queues = new Map(Object.entries(recording).map(([title, messages]) => [title, [...messages]]));
    return body => {
        const title = firstText(body).match(/^# Aspect: (.+)$/m)?.[1];
        const queue = title === undefined ? undefined : queues.get(title);
        if (!queue) return { missing: `no recording for the aspect "${title ?? "(none named)"}"` };
        const message = queue.shift();
        return message ? { message } : { missing: `no recorded message left for the aspect "${title}"` };
    };
}

/** A fetch that answers each Messages request with the next recorded message, streamed. */
export function replayFetch(recording: Recording): { fetch: typeof fetch; requests: CapturedRequest[] } {
    const next = recordedQueue(recording);
    const requests: CapturedRequest[] = [];
    const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input instanceof Request ? input.url : input);
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        requests.push({ url, headers, body });
        const { message, missing } = next(body);
        if (!message) throw new Error(`replayFetch: ${missing} for request ${requests.length}`);
        return new Response(messageToSse(message), {
            status: 200,
            headers: { "content-type": "text/event-stream", "request-id": `req_test_${requests.length}` }
        });
    };
    return { fetch: fake as typeof fetch, requests };
}

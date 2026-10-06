import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * The prompt as a stream of user turns. It stays open until closed: in-process MCP tools talk to
 * the subprocess over the same channel, and a one-shot string prompt would close it after the
 * first turn. A nudge after a turn is just another push.
 */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
    private items: string[] = [];
    private wake: (() => void) | null = null;
    private closed = false;

    push(text: string): void {
        this.items.push(text);
        this.wake?.();
    }

    close(): void {
        this.closed = true;
        this.wake?.();
    }

    async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        for (;;) {
            const text = this.items.shift();
            if (text !== undefined) {
                yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
                continue;
            }
            if (this.closed) return;
            await new Promise<void>(resolve => (this.wake = resolve));
            this.wake = null;
        }
    }
}

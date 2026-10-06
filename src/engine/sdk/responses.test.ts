import { afterEach, describe, expect, it, vi } from "vitest";

import { Responses } from "./responses";

afterEach(() => vi.useRealTimers());

describe("Responses", () => {
    it("gives each call its response's stop reason, whether it waits before or after the end", async () => {
        const r = new Responses();
        const early = r.stopReasonOf("toolu_a");
        r.toolUse("toolu_a");
        r.toolUse("toolu_b");
        r.end("tool_use");
        r.toolUse("toolu_c");
        r.end("refusal");
        await expect(early).resolves.toBe("tool_use");
        await expect(r.stopReasonOf("toolu_b")).resolves.toBe("tool_use");
        await expect(r.stopReasonOf("toolu_c")).resolves.toBe("refusal");
    });

    it("releases every waiting call on abort", async () => {
        const r = new Responses();
        r.toolUse("toolu_a");
        const wait = r.stopReasonOf("toolu_a");
        r.abort();
        await expect(wait).resolves.toBeNull();
    });

    // The review's Critical 1: a response whose end never reaches the engine must not hang the run and the queue.
    it("stops waiting at its ceiling", async () => {
        vi.useFakeTimers();
        const r = new Responses(1000);
        const wait = r.stopReasonOf("toolu_never");
        vi.advanceTimersByTime(1000);
        await expect(wait).resolves.toBeNull();
    });
});

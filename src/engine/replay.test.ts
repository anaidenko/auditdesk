import { describe, expect, it } from "vitest";

import { message, recordedQueue, replayFetch } from "./replay";

const text = (t: string) => message({ content: [{ type: "text", text: t, citations: null }], stop_reason: "end_turn" } as never);
const ask = (aspect: string) => ({
    messages: [{ role: "user", content: [{ type: "text", text: `# Aspect: ${aspect}\n\nThe checklist.` }] }]
});

describe("recordedQueue", () => {
    it("keeps a plain recording as one queue for every request", () => {
        const next = recordedQueue([text("a"), text("b")]);
        expect([next(ask("Security")), next(ask("Code quality and tests"))].map(m => (m!.content[0] as { text: string }).text)).toEqual([
            "a",
            "b"
        ]);
    });

    it("serves each aspect's agent from that aspect's own recording", () => {
        const next = recordedQueue({ "Security": [text("sec")], "Code quality and tests": [text("qua")] });
        expect((next(ask("Code quality and tests"))!.content[0] as { text: string }).text).toBe("qua");
        expect((next(ask("Security"))!.content[0] as { text: string }).text).toBe("sec");
        expect(next(ask("Security"))).toBeUndefined();
    });
});

describe("replayFetch", () => {
    it("routes a keyed recording by the aspect of the request", async () => {
        const { fetch } = replayFetch({ "Security": [text("sec")], "Data model and database": [text("dat")] });
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            body: JSON.stringify(ask("Data model and database"))
        });
        expect(await res.text()).toContain('"text":"dat"');
    });
});

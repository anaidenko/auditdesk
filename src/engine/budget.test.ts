import { describe, expect, it } from "vitest";

import { message, usage } from "@/engine/replay";

import { DEFAULT_MODEL } from "./agent/request";
import { exhausted, shareFor, validateBudget } from "./budget";
import { priceMessage } from "./prices";

describe("priceMessage", () => {
    it("prices a plain call by the requested model", () => {
        const m = message({
            content: [],
            stop_reason: "end_turn",
            usage: usage({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 })
        });
        const p = priceMessage("claude-opus-5-5", m);
        expect(p).toMatchObject({ servedModel: "claude-opus-5-5", fallback: false });
        expect(p.costUsd).toBeCloseTo(4 + 2 + 0.2, 6);
    });

    it("prices each attempt by the model that ran it when a fallback served the call", () => {
        const m = message({
            content: [],
            stop_reason: "end_turn",
            model: "claude-opus-4-8",
            usage: usage({
                input_tokens: 1_000_000,
                iterations: [
                    {
                        type: "message",
                        model: "claude-opus-5-5",
                        input_tokens: 0,
                        output_tokens: 0,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0,
                        cache_creation: null
                    },
                    {
                        type: "fallback_message",
                        model: "claude-opus-4-8",
                        input_tokens: 1_000_000,
                        output_tokens: 0,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0,
                        cache_creation: null
                    }
                ]
            })
        });
        const p = priceMessage("claude-opus-5-5", m);
        expect(p).toMatchObject({ servedModel: "claude-opus-4-8", fallback: true });
        expect(p.costUsd).toBeCloseTo(5, 6);
        // The serving model comes from the iterations, whatever the top-level field says.
        expect(priceMessage("claude-opus-5-5", { ...m, model: "claude-opus-5-5" }).servedModel).toBe("claude-opus-4-8");
    });

    it("splits cache writes into 5-minute and 1-hour", () => {
        const m = message({
            content: [],
            stop_reason: "end_turn",
            usage: usage({
                cache_creation_input_tokens: 2_000_000,
                cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 }
            })
        });
        expect(priceMessage("claude-opus-5-5", m).costUsd).toBeCloseTo(5 + 8, 6);
    });

    it("prices the default model and Sonnet 5, where its cyber and frontier_llm declines fall back", () => {
        const call = (model: string) =>
            message({
                content: [],
                stop_reason: "end_turn",
                model,
                usage: usage({
                    input_tokens: 1_000_000,
                    output_tokens: 1_000_000,
                    cache_read_input_tokens: 1_000_000,
                    cache_creation_input_tokens: 1_000_000
                })
            });
        expect(priceMessage(DEFAULT_MODEL, call(DEFAULT_MODEL)).costUsd).toBeCloseTo(2 + 10 + 0.2 + 2.5, 6);
        expect(priceMessage(DEFAULT_MODEL, call("claude-sonnet-5")).costUsd).toBeCloseTo(2 + 10 + 0.2 + 2.5, 6);
    });

    it("returns no cost for a model without a price row", () => {
        const m = message({ content: [], stop_reason: "end_turn", model: "claude-new-model" });
        expect(priceMessage("claude-new-model", m).costUsd).toBeNull();
    });
});

describe("budget", () => {
    it("divides the run's budget evenly between its agents", () => {
        expect(shareFor({ usd: 10, tokens: 400_000 }, 4)).toEqual({ usd: 2.5, tokens: 100_000 });
    });

    it("refuses a budget whose share falls under the task-budget minimum", () => {
        expect(validateBudget({ usd: 10, tokens: 60_000 }, 4)).toMatch(/20,000/);
        expect(validateBudget({ usd: 10, tokens: 80_000 }, 4)).toBeNull();
    });

    it("stops when a call cannot be priced", () => {
        expect(exhausted({ usd: 0, freshTokens: 0, unpriced: true }, { usd: 10, tokens: 100_000 })).toBe(true);
    });

    it("stops at the dollar cap, and at the token backstop", () => {
        expect(exhausted({ usd: 10, freshTokens: 0, unpriced: false }, { usd: 10, tokens: 100_000 })).toBe(true);
        expect(exhausted({ usd: 0, freshTokens: 200_000, unpriced: false }, { usd: 10, tokens: 100_000 })).toBe(true);
        expect(exhausted({ usd: 9.99, freshTokens: 199_999, unpriced: false }, { usd: 10, tokens: 100_000 })).toBe(false);
    });
});

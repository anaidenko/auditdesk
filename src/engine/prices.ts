import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { TokenUsage } from "./types";

/** Dollars per million tokens. Source and date: the Claude pricing page, read on PRICES_AS_OF. */
export interface ModelPrice {
    input: number;
    output: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
    cacheRead: number;
}

export const PRICES_AS_OF = "2026-10-06";

export const PRICES: Readonly<Record<string, ModelPrice>> = {
    "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
    "claude-opus-5-5": { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
    // Fallback targets for refusals (design § 8): priced so a fallback call is never free in the ledger.
    "claude-sonnet-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
    "claude-opus-5": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    "claude-opus-4-8": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 }
};

type Attempt = {
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    c5m: number | null;
    c1h: number | null;
};

function attemptCost(a: Attempt): number | null {
    const p = PRICES[a.model];
    if (!p) return null;
    // Without the split, treat all cache writes as 5-minute ones (the default TTL).
    const c5m = a.c5m ?? a.cacheCreation;
    const c1h = a.c1h ?? 0;
    return (a.input * p.input + a.output * p.output + a.cacheRead * p.cacheRead + c5m * p.cacheWrite5m + c1h * p.cacheWrite1h) / 1_000_000;
}

/**
 * Prices a response by the model that ran each attempt (design § 8). `usage.iterations` is the
 * per-attempt record when a fallback ran. A declined attempt reported there but not billed is
 * priced anyway, so the ledger errs high, never low.
 */
export function priceMessage(
    requestedModel: string,
    m: BetaMessage
): { servedModel: string; fallback: boolean; usage: TokenUsage; costUsd: number | null } {
    const u = m.usage;
    const attempts: Attempt[] = (u.iterations?.length ? u.iterations : null)
        ?.filter(i => i.type === "message" || i.type === "fallback_message")
        .map(i => ({
            model: ("model" in i && i.model) || requestedModel,
            input: i.input_tokens,
            output: i.output_tokens,
            cacheRead: i.cache_read_input_tokens,
            cacheCreation: i.cache_creation_input_tokens,
            c5m: i.cache_creation?.ephemeral_5m_input_tokens ?? null,
            c1h: i.cache_creation?.ephemeral_1h_input_tokens ?? null
        })) ?? [
        {
            model: m.model,
            input: u.input_tokens,
            output: u.output_tokens,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheCreation: u.cache_creation_input_tokens ?? 0,
            c5m: u.cache_creation?.ephemeral_5m_input_tokens ?? null,
            c1h: u.cache_creation?.ephemeral_1h_input_tokens ?? null
        }
    ];
    const costs = attempts.map(attemptCost);
    const sum = (f: (a: Attempt) => number) => attempts.reduce((s, a) => s + f(a), 0);
    // The serving model is read from usage.iterations (design § 8); top-level `model` only when no fallback ran.
    const fallbackAttempt = u.iterations?.filter(i => i.type === "fallback_message").at(-1);
    return {
        servedModel: fallbackAttempt && "model" in fallbackAttempt ? fallbackAttempt.model : m.model,
        fallback: u.iterations?.some(i => i.type === "fallback_message") ?? false,
        usage: {
            input: sum(a => a.input),
            output: sum(a => a.output),
            cacheRead: sum(a => a.cacheRead),
            cacheWrite5m: sum(a => a.c5m ?? a.cacheCreation),
            cacheWrite1h: sum(a => a.c1h ?? 0)
        },
        costUsd: costs.includes(null) ? null : (costs as number[]).reduce((s, c) => s + c, 0)
    };
}

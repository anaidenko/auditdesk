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
    "claude-opus-5-5": { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
    // Fallback targets for refusals (design § 8): priced so a fallback call is never free in the ledger.
    "claude-opus-5": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    "claude-opus-4-8": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 }
};

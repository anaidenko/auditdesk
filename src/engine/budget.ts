import type { Spend, TokenUsage } from "./types";

/** The API rejects a task budget under this many tokens (claude-api skill, Task Budgets). */
export const MIN_TASK_BUDGET = 20_000;

export function freshTokens(u: TokenUsage): number {
    return u.input + u.cacheWrite5m + u.cacheWrite1h + u.output;
}

export function shareFor(budget: { usd: number; tokens: number }, agents: number): { usd: number; tokens: number } {
    return { usd: budget.usd / agents, tokens: Math.floor(budget.tokens / agents) };
}

// The run form takes the cap in thousands (Andrii, 2026-10-06), so the refusal speaks that unit.
const k = (n: number) => (n / 1000).toLocaleString("en-US");

export function validateBudget(budget: { usd: number; tokens: number }, agents: number): string | null {
    if (!(budget.usd > 0)) return "Set a dollar cap above zero.";
    const share = shareFor(budget, agents);
    if (share.tokens < MIN_TASK_BUDGET)
        return `Each of the ${agents} agents would get ${k(share.tokens)} thousand tokens; the API needs at least ${k(MIN_TASK_BUDGET)} thousand. Raise the cap to ${k(MIN_TASK_BUDGET * agents)} thousand or more.`;
    return null;
}

/**
 * The engine's fresh-token count runs ahead of the API's task-budget countdown (it includes the
 * prefix's cache write, and each turn's output is written again next turn), so tokens stop an
 * agent only at this multiple of its share. Dollars are the hard cap. Re-set from Task 1.18.
 */
export const TOKEN_BACKSTOP = 2;

/** Checked between calls: one call may overshoot by its own cost, and the report says so. */
export function exhausted(spend: Spend, share: { usd: number; tokens: number }): boolean {
    return spend.unpriced || spend.usd >= share.usd || spend.freshTokens >= share.tokens * TOKEN_BACKSTOP;
}

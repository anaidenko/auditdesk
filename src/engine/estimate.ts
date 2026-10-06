/** One agent's API-equivalent dollars: the median and the 90th percentile of past agents. */
export interface CostStats {
    samples: number;
    low: number;
    high: number;
}

/**
 * Before any run on a model, the first measured audit stands in: one security agent on a small
 * site cost $0.11 on Sonnet 5.5 at low (2026-10-06); Opus 5.5 is priced at twice Sonnet 5.5.
 * The range spans ten times that, for larger repositories and efforts.
 */
export const BASELINE_USD: Readonly<Record<string, number>> = { "claude-sonnet-5-5": 0.11, "claude-opus-5-5": 0.22 };

const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => `$${x.toFixed(2)}`;

export function costStats(costs: number[], baseline = 0): CostStats {
    if (!costs.length) return { samples: 0, low: cents(baseline), high: cents(baseline * 10) };
    const sorted = [...costs].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    return { samples: costs.length, low: cents(at(0.5)), high: cents(at(0.9)) };
}

/**
 * The pre-run estimate (design § 6). It is built from past agents rather than counted tokens:
 * `count_tokens` needs an API key, which Claude plan access does not have, and the prefix it would
 * count holds the repository map, which exists only after the clone.
 */
export function estimateRun(
    stats: CostStats,
    agents: number,
    capUsd: number
): { low: number; high: number; text: string; warning: string | null } {
    const low = cents(stats.low * agents);
    const high = cents(stats.high * agents);
    const basis = stats.samples
        ? `from ${stats.samples} past ${stats.samples === 1 ? "agent" : "agents"} on this model`
        : "a guess from one measured run until runs on this model are recorded";
    const warning =
        capUsd < low
            ? `The cap (${money(capUsd)}) is below even the low end: agents will stop partly covered.`
            : capUsd < high
              ? `The cap (${money(capUsd)}) is below the estimate's high end: some agents may stop partly covered.`
              : null;
    return { low, high, text: `About ${money(low)}–${money(high)} for ${agents} ${agents === 1 ? "agent" : "agents"}, ${basis}.`, warning };
}

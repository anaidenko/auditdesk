import type { Effort } from "./agent/request";
import { EFFORTS, modelLabel } from "./models";

/** One agent's API-equivalent dollars from past agents on one model and effort. */
export interface CostStats {
    samples: number;
    /** Agents whose cost reached their share: their cost is a lower bound of what they needed. */
    capped: number;
    low: number;
    high: number;
    /** Fewer than five samples, or none: the range is widened and the text says so. */
    thin: boolean;
}

/**
 * Before any run on a model, the first measured audit stands in: one security agent on a small
 * site cost $0.11 on Sonnet 5.5 at low (2026-10-06). Opus 5.5 costs twice Sonnet 5.5 for input,
 * output and cache writes and the same for cache reads; twice is the cautious guess. The range
 * spans ten times that, for larger repositories and efforts.
 */
export const BASELINE_USD: Readonly<Record<string, number>> = { "claude-sonnet-5-5": 0.11, "claude-opus-5-5": 0.22 };

const THIN = 5;
const exact = (x: number) => Math.round(x * 1e6) / 1e6;
const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => `$${x.toFixed(2)}`;

export function costStats(costs: number[], baseline = 0, capped = 0): CostStats {
    if (!costs.length) return { samples: 0, capped: 0, low: exact(baseline), high: exact(baseline * 10), thin: true };
    const sorted = [...costs].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)];
    const thin = sorted.length < THIN;
    return { samples: sorted.length, capped, low: exact(median), high: exact(thin ? Math.max(p90, 2 * sorted.at(-1)!) : p90), thin };
}

/** The statistics to estimate a model and effort from: its own, else another effort's, else the baseline. */
export function pickStats(
    stats: Record<string, CostStats>,
    model: string,
    effort: Effort
): { stats: CostStats; basis: { from?: Effort; fromCheaper?: boolean; guess?: string } } {
    const own = stats[`${model}/${effort}`];
    if (own?.samples) return { stats: own, basis: {} };
    const at = EFFORTS.indexOf(effort);
    // The nearest effort with history, the cheaper side first.
    const others = [...EFFORTS].sort(
        (a, b) => Math.abs(EFFORTS.indexOf(a) - at) - Math.abs(EFFORTS.indexOf(b) - at) || EFFORTS.indexOf(a) - EFFORTS.indexOf(b)
    );
    for (const e of others) {
        const s = stats[`${model}/${e}`];
        if (s?.samples) return { stats: s, basis: { from: e, fromCheaper: EFFORTS.indexOf(e) < at } };
    }
    return { stats: costStats([], BASELINE_USD[model] ?? BASELINE_USD["claude-opus-5-5"]), basis: { guess: model } };
}

/**
 * The pre-run estimate (design § 6). It is built from past agents rather than counted tokens:
 * `count_tokens` needs an API key, which Claude plan access does not have, and the prefix it would
 * count holds the repository map, which exists only after the clone.
 */
export function estimateRun(
    stats: CostStats,
    agents: number,
    capUsd: number,
    basis: { from?: Effort; fromCheaper?: boolean; guess?: string } = {}
): { low: number; high: number; text: string; warning: string | null } {
    const low = cents(stats.low * agents);
    const high = cents(stats.high * agents);
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    let from: string;
    if (!stats.samples) {
        from =
            basis.guess === "claude-sonnet-5-5" || !basis.guess
                ? "a guess from one measured run until runs on this model are recorded"
                : `a guess from one Claude Sonnet 5.5 run, doubled for ${modelLabel(basis.guess).replace("Claude ", "")}, until runs on this model are recorded`;
    } else {
        from = `from ${plural(stats.samples, "past agent", "past agents")} on this model ${
            basis.from ? `at ${basis.from} effort, which may cost ${basis.fromCheaper === false ? "more" : "less"}` : "and effort"
        }`;
        if (stats.thin) from += "; few runs so far, so the range is wide";
        if (stats.capped)
            from += `; ${stats.capped} of them hit ${stats.capped === 1 ? "its" : "their"} cap, so the high end may be higher`;
    }
    const warning =
        capUsd < low
            ? `The cap (${money(capUsd)}) is below the typical cost: most agents may stop partly covered.`
            : capUsd < high
              ? `The cap (${money(capUsd)}) is below the estimate's high end: some agents may stop partly covered.`
              : null;
    return { low, high, text: `About ${money(low)}–${money(high)} for ${plural(agents, "agent", "agents")}, ${from}.`, warning };
}

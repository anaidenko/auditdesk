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

/**
 * A reading of the plan's 5-hour window during a run, as a fraction, with its reset when known.
 * `part`: the job it was read in; a re-run is another job of the same run, and the use of the plan
 * between the two belongs to neither.
 */
export interface PlanReadingAt {
    utilization: number;
    resetsAt: Date | null;
    part: string | null;
    at: Date;
}

/**
 * The points of the 5-hour window a run used, and the API-equivalent dollars of its calls meanwhile.
 * The readings are split where the window reset (a lower reading, or another reset time) and where
 * another job began. Each part counts from the reading's first change to its last, with the calls
 * priced between them: the plan reports a reading when its whole per cent changes, so the first one
 * of a part falls anywhere within its per cent and would round the share up. Null when no part
 * changed twice, or a part holds an unpriced call.
 */
export function windowShare(
    readings: PlanReadingAt[],
    calls: { costUsd: number | null; at: Date }[]
): { points: number; usd: number } | null {
    const parts: PlanReadingAt[][] = [];
    for (const r of readings) {
        const last = parts.at(-1)?.at(-1);
        const split =
            !last ||
            r.part !== last.part ||
            r.utilization < last.utilization ||
            (!!r.resetsAt && !!last.resetsAt && r.resetsAt.getTime() !== last.resetsAt.getTime());
        if (split) parts.push([r]);
        else parts.at(-1)!.push(r);
    }
    let points = 0;
    let usd = 0;
    for (const part of parts) {
        const first = part.find(r => r.utilization > part[0].utilization);
        const last = part.at(-1)!;
        if (!first || last.utilization <= first.utilization) continue;
        const between = calls.filter(c => c.at > first.at && c.at <= last.at);
        if (between.some(c => c.costUsd === null)) return null;
        points += (last.utilization - first.utilization) * 100;
        usd += between.reduce((s, c) => s + c.costUsd!, 0);
    }
    return usd > 0 ? { points, usd } : null;
}

/** Points of the plan's 5-hour window per API-equivalent dollar, from the runs it was measured on. */
export interface PlanShareRate {
    pointsPerUsd: number;
    runs: number;
}

export function shareRate(shares: ({ points: number; usd: number } | null)[]): PlanShareRate | null {
    const known = shares.filter(s => s !== null);
    const usd = known.reduce((s, x) => s + x.usd, 0);
    return usd > 0 ? { pointsPerUsd: known.reduce((s, x) => s + x.points, 0) / usd, runs: known.length } : null;
}

/**
 * What the estimate would take of the plan's 5-hour window, as far as the dollar cap lets the run
 * spend, and, from the last reading while its window lasts, whether the run may stop at the reserve
 * partway. The rate counts any other use of the plan in the same window, such as Claude Code, so it
 * leans high.
 */
export function forecastPlanShare(
    estimate: { low: number; high: number },
    rate: PlanShareRate | null,
    reading: { utilization: number; seen: string } | null,
    reserve: number,
    capUsd: number
): { text: string; mayCross: boolean; warning: string | null } {
    if (!rate)
        return {
            text: "Share of the plan's 5-hour window: not measured yet; a Claude plan run that moves the window's reading by two points or more measures it.",
            mayCross: false,
            warning: null
        };
    const capped = capUsd < estimate.high;
    const [low, high] = [Math.min(estimate.low, capUsd) * rate.pointsPerUsd, Math.min(estimate.high, capUsd) * rate.pointsPerUsd];
    const span = Math.round(low) === Math.round(high) ? `${Math.round(low)}%` : `${Math.round(low)}–${Math.round(high)}%`;
    const text = `About ${span} of the plan's 5-hour window${capped ? `, as far as the ${money(capUsd)} cap allows` : ""}${high > 100 ? ", more than one window" : ""}, at ${rate.pointsPerUsd.toFixed(1)}% per API-equivalent dollar from ${rate.runs} past ${rate.runs === 1 ? "run" : "runs"}; other use of the plan in the same window counts in that rate, so it leans high.`;
    const room = reading === null ? null : (reserve - reading.utilization) * 100;
    if (room === null || room < 0 || high <= room) return { text, mayCross: false, warning: null };
    return {
        text,
        mayCross: true,
        warning: `At ${Math.round(reading!.utilization * 100)}% when last read (${reading!.seen}), about ${money(room / rate.pointsPerUsd)} of API-equivalent fits under the ${Math.round(reserve * 100)}% reserve: the run ${low > room ? "is likely to" : "may"} stop there partway, and the rest can be re-run after the window resets. Tick the box to let it go past.`
    };
}

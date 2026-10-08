import { describe, expect, it } from "vitest";

import { BASELINE_USD, costStats, estimateRun, forecastPlanShare, pickStats, shareRate, windowShare } from "./estimate";
import { MODEL_CHOICES } from "./models";

describe("costStats", () => {
    it("takes the median and the 90th percentile of past agents' costs, without rounding", () => {
        expect(costStats([0.1, 0.2, 0.3, 0.4, 1, 1.1])).toEqual({ samples: 6, capped: 0, low: 0.35, high: 1.1, thin: false });
    });

    it("widens a range built from fewer than five agents, and says it is thin", () => {
        expect(costStats([0.4])).toEqual({ samples: 1, capped: 0, low: 0.4, high: 0.8, thin: true });
    });

    it("counts the agents that hit their cap apart, since their cost is only a lower bound", () => {
        expect(costStats([0.2, 0.2, 0.2, 0.2, 0.2], 0.1, 3)).toMatchObject({ samples: 5, capped: 3 });
    });

    it("falls back to a wide guess from the measured first run when there is no history", () => {
        expect(costStats([], 0.11)).toEqual({ samples: 0, capped: 0, low: 0.11, high: 1.1, thin: true });
    });

    it("has a baseline for every model the picker offers", () => {
        for (const m of MODEL_CHOICES) expect(BASELINE_USD[m.id], m.id).toBeGreaterThan(0);
    });
});

describe("estimateRun", () => {
    const stats = { samples: 6, capped: 0, low: 0.2, high: 0.5, thin: false };

    it("multiplies the per-agent range by the number of agents, rounding only the result", () => {
        expect(estimateRun({ ...stats, low: 0.0149, high: 0.0149 }, 16, 10).low).toBe(0.24);
        expect(estimateRun(stats, 6, 10)).toEqual({
            low: 1.2,
            high: 3,
            text: "About $1.20–$3.00 for 6 agents, from 6 past agents on this model and effort.",
            warning: null
        });
    });

    it("says before the run starts when the cap is below the estimate", () => {
        expect(estimateRun(stats, 6, 2).warning).toBe(
            "The cap ($2.00) is below the estimate's high end: some agents may stop partly covered."
        );
        expect(estimateRun(stats, 6, 1).warning).toBe("The cap ($1.00) is below the typical cost: most agents may stop partly covered.");
    });

    it("names a thin history, agents that hit their cap, and a basis taken from another effort", () => {
        const text = estimateRun({ ...stats, samples: 2, capped: 1, thin: true }, 1, 10, { from: "low" }).text;
        expect(text).toBe(
            "About $0.20–$0.50 for 1 agent, from 2 past agents on this model at low effort, which may cost less; few runs so far, so the range is wide; 1 of them hit its cap, so the high end may be higher."
        );
    });

    it("says what a guess rests on when no past agent ran on this model", () => {
        expect(estimateRun({ samples: 0, capped: 0, low: 0.22, high: 2.2, thin: true }, 1, 10, { guess: "claude-opus-5-5" }).text).toBe(
            "About $0.22–$2.20 for 1 agent, a guess from one Claude Sonnet 5.5 run, doubled for Opus 5.5, until runs on this model are recorded."
        );
    });
});

describe("pickStats", () => {
    const s = (samples: number) => ({ samples, capped: 0, low: 0.1, high: 0.2, thin: false });

    it("uses the model and effort's own history when it has one", () => {
        expect(pickStats({ "claude-sonnet-5-5/high": s(6) }, "claude-sonnet-5-5", "high").basis).toEqual({});
    });

    it("borrows the nearest effort's history, the cheaper side first, and says which", () => {
        const stats = { "claude-sonnet-5-5/medium": s(3), "claude-sonnet-5-5/xhigh": s(3) };
        expect(pickStats(stats, "claude-sonnet-5-5", "high").basis).toEqual({ from: "medium", fromCheaper: true });
        expect(pickStats({ "claude-sonnet-5-5/max": s(3) }, "claude-sonnet-5-5", "low").basis).toEqual({ from: "max", fromCheaper: false });
    });

    it("falls back to the model's baseline when no effort has history", () => {
        const picked = pickStats({}, "claude-opus-5-5", "max");
        expect(picked.basis).toEqual({ guess: "claude-opus-5-5" });
        expect(picked.stats).toMatchObject({ samples: 0, low: 0.22, high: 2.2 });
    });
});

describe("windowShare", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 8, 7, minute));
    const reset = new Date(Date.UTC(2026, 9, 8, 12, 20));
    const reading = (minute: number, utilization: number, resetsAt: Date | null = reset) => ({ utilization, resetsAt, at: at(minute) });
    const call = (minute: number, costUsd: number | null) => ({ costUsd, at: at(minute) });

    it("counts the points between the first and last reading, and the calls priced after the first up to the last", () => {
        const share = windowShare(
            [reading(1, 0.07), reading(10, 0.12), reading(30, 0.3)],
            [call(0, 5), call(2, 4), call(30, 7), call(31, 9)]
        );
        expect(share?.usd).toBe(11);
        expect(share?.points).toBeCloseTo(23);
    });

    it("splits the readings where the window reset, by a lower reading or another reset time, and adds the parts", () => {
        const later = new Date(Date.UTC(2026, 9, 8, 17, 20));
        const share = windowShare(
            [
                reading(1, 0.4),
                reading(5, 0.45),
                reading(10, 0.02, later),
                reading(20, 0.05, later),
                reading(25, 0.01, null),
                reading(26, 0.02, null)
            ],
            [call(3, 1), call(15, 1), call(26, 0.5)]
        );
        expect(share?.usd).toBe(2.5);
        expect(share?.points).toBeCloseTo(9);
    });

    it("leaves out a run with no two readings in one window, and one with an unpriced call between readings", () => {
        expect(windowShare([reading(1, 0.59)], [call(2, 0.1)])).toBeNull();
        expect(windowShare([reading(1, 0.1), reading(9, 0.2)], [call(5, null)])).toBeNull();
        expect(windowShare([reading(1, 0.1), reading(9, 0.1)], [])).toBeNull();
    });
});

describe("shareRate", () => {
    it("weighs each run by its dollars and counts the runs it learnt from", () => {
        const rate = shareRate([{ points: 1, usd: 0.07 }, null, { points: 9, usd: 3.49 }, { points: 23, usd: 11.13 }]);
        expect(rate?.runs).toBe(3);
        expect(rate?.pointsPerUsd).toBeCloseTo(33 / 14.69, 10);
        expect(shareRate([null])).toBeNull();
    });
});

describe("forecastPlanShare", () => {
    const rate = { pointsPerUsd: 2.25, runs: 3 };

    it("says the window's share is not measured before a first plan run", () => {
        expect(forecastPlanShare({ low: 9, high: 16 }, null, 0.3, 0.5)).toEqual({
            text: "Share of the plan's 5-hour window: not measured yet; the first Claude plan run measures it.",
            mayCross: false,
            warning: null
        });
    });

    it("multiplies the estimate by the measured rate, and says the rate leans high", () => {
        const f = forecastPlanShare({ low: 9, high: 16 }, rate, null, 0.5);
        expect(f.text).toBe(
            "About 20–36% of the plan's 5-hour window, at 2.3% per API-equivalent dollar from 3 past runs; other use of the plan in the same window counts in that rate, so it leans high."
        );
        expect(f).toMatchObject({ mayCross: false, warning: null });
    });

    it("says when the high end would take more than one window", () => {
        expect(forecastPlanShare({ low: 6.66, high: 68.84 }, { pointsPerUsd: 2.25, runs: 1 }, null, 0.5).text).toMatch(
            /^About 15–155% of the plan's 5-hour window, more than one window, at 2\.3% per API-equivalent dollar from 1 past run;/
        );
    });

    it("warns that the run may stop at the reserve partway when its high end does not fit in the room left", () => {
        expect(forecastPlanShare({ low: 6, high: 12 }, rate, 0.3, 0.5)).toMatchObject({
            mayCross: true,
            warning:
                "At 30% now, about $8.89 of API-equivalent fits under the 50% reserve: the run may stop there partway, and the rest can be re-run after the window resets. Tick the box to let it go past."
        });
        expect(forecastPlanShare({ low: 10, high: 12 }, rate, 0.3, 0.5).warning).toMatch(/the run is likely to stop there partway/);
        expect(forecastPlanShare({ low: 2, high: 8 }, rate, 0.3, 0.5)).toMatchObject({ mayCross: false, warning: null });
    });

    it("names the reserve it was given, and says nothing of the room when the last reading's window has reset", () => {
        expect(forecastPlanShare({ low: 6, high: 40 }, rate, 0.3, 0.8).warning).toMatch(/under the 80% reserve/);
        expect(forecastPlanShare({ low: 6, high: 40 }, rate, null, 0.5)).toMatchObject({ mayCross: false, warning: null });
    });

    it("leaves a reading already past the reserve to the refusal the form shows", () => {
        expect(forecastPlanShare({ low: 6, high: 40 }, rate, 0.62, 0.5)).toMatchObject({ mayCross: false, warning: null });
    });
});

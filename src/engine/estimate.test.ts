import { describe, expect, it } from "vitest";

import { BASELINE_USD, costStats, estimateRun, pickStats } from "./estimate";
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

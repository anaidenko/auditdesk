import { describe, expect, it } from "vitest";

import { costStats, estimateRun } from "./estimate";

describe("costStats", () => {
    it("takes the median and the 90th percentile of past agents' costs", () => {
        expect(costStats([0.1, 0.2, 0.3, 0.4, 1])).toEqual({ samples: 5, low: 0.3, high: 1 });
    });

    it("falls back to a wide guess from the measured first run when there is no history", () => {
        expect(costStats([], 0.11)).toEqual({ samples: 0, low: 0.11, high: 1.1 });
    });
});

describe("estimateRun", () => {
    const stats = { samples: 4, low: 0.2, high: 0.5 };

    it("multiplies the per-agent range by the number of agents", () => {
        expect(estimateRun(stats, 6, 10)).toEqual({
            low: 1.2,
            high: 3,
            text: "About $1.20–$3.00 for 6 agents, from 4 past agents on this model.",
            warning: null
        });
    });

    it("says before the run starts when the cap is below the estimate", () => {
        expect(estimateRun(stats, 6, 2).warning).toBe(
            "The cap ($2.00) is below the estimate's high end: some agents may stop partly covered."
        );
        expect(estimateRun(stats, 6, 1).warning).toBe("The cap ($1.00) is below even the low end: agents will stop partly covered.");
    });

    it("says it is a guess when no past agent ran on this model", () => {
        expect(estimateRun({ samples: 0, low: 0.11, high: 1.1 }, 1, 10).text).toBe(
            "About $0.11–$1.10 for 1 agent, a guess from one measured run until runs on this model are recorded."
        );
    });
});

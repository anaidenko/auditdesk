import { describe, expect, it } from "vitest";

import { DEFAULT_EFFORT, DEFAULT_MODEL } from "./agent/request";
import { EFFORTS, MODEL_CHOICES } from "./models";
import { PRICES } from "./prices";

describe("the model and effort choices", () => {
    it("prices every model the picker offers", () => {
        for (const m of MODEL_CHOICES) expect(PRICES[m.id], m.id).toBeDefined();
    });

    it("offers the default model first, and every effort in order with the default among them", () => {
        expect(MODEL_CHOICES[0].id).toBe(DEFAULT_MODEL);
        expect(EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
        expect(EFFORTS).toContain(DEFAULT_EFFORT);
    });
});

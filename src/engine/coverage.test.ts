import { describe, expect, it } from "vitest";

import { limitedReview } from "./coverage";

const of = (...statuses: string[]) => statuses.map((status, i) => ({ item: `SEC-0${i + 1}`, status }));

describe("limitedReview", () => {
    it("calls a review limited when fewer than half of the items were looked at", () => {
        expect(limitedReview(of("examined", "not_examined", "not_examined"))).toBe(true);
        expect(limitedReview(of("partly", "not_reported", "not_reported", "not_examined"))).toBe(true);
    });

    it("does not when half or more were examined or partly examined, or when there is no coverage", () => {
        expect(limitedReview(of("examined", "not_examined"))).toBe(false);
        expect(limitedReview(of("partly", "examined", "not_examined"))).toBe(false);
        expect(limitedReview([])).toBe(false);
    });
});

import { describe, expect, it } from "vitest";

import { formatHours, formatTotal, hoursError, hoursFrom, sizeAndHours, sizeOf, totalHours } from "./effort";

describe("effort", () => {
    it("sizes a range by its high end, so the letter never contradicts the hours", () => {
        expect(sizeOf({ low: 1, high: 2 })).toBe("S");
        expect(sizeOf({ low: 1, high: 3 })).toBe("M");
        expect(sizeOf({ low: 8, high: 16 })).toBe("M");
        expect(sizeOf({ low: 12, high: 24 })).toBe("L");
    });

    it("writes a range with an en dash, and a single number when both ends agree", () => {
        expect(formatHours({ low: 2, high: 4 })).toBe("2–4 h");
        expect(formatHours({ low: 3, high: 3 })).toBe("3 h");
    });

    it("puts the hours beside the size for the review list, when there are any", () => {
        expect(sizeAndHours("S", { low: 1, high: 2 })).toBe("S · 1–2 h");
        expect(sizeAndHours("M", null)).toBe("M");
    });

    it("refuses hours that are not whole, start below 1, or run backwards", () => {
        expect(hoursError({ low: 1, high: 2 })).toBeNull();
        expect(hoursError({ low: 0, high: 2 })).toMatch(/from 1/);
        expect(hoursError({ low: 1.5, high: 2 })).toMatch(/whole/);
        expect(hoursError({ low: 4, high: 2 })).toMatch(/low .* high/);
        expect(hoursError({ low: 1, high: 1000 })).toMatch(/split/);
    });

    it("reads the editor's two fields: both, one alone as a single number, or neither", () => {
        expect(hoursFrom("2", "4")).toEqual({ low: 2, high: 4 });
        expect(hoursFrom(null, "3")).toEqual({ low: 3, high: 3 });
        expect(hoursFrom("3", null)).toEqual({ low: 3, high: 3 });
        expect(hoursFrom(null, null)).toBeNull();
    });

    it("adds the hours set, counts a finding with only a size at its size's range, and leaves the unsized out", () => {
        const t = totalHours([
            { effort: "S", effortHours: { low: 1, high: 2 } },
            { effort: "M", effortHours: { low: 4, high: 8 } },
            { effort: "S", effortHours: null },
            { effort: "M", effortHours: null },
            { effort: null, effortHours: null }
        ]);
        expect(t).toEqual({ low: 1 + 4 + 1 + 2, high: 2 + 8 + 2 + 16, bySize: 2, unsized: 1 });
    });

    it("has no high end when a large finding carries no hours", () => {
        const t = totalHours([
            { effort: "S", effortHours: { low: 1, high: 2 } },
            { effort: "L", effortHours: null }
        ]);
        expect(t).toEqual({ low: 17, high: null, bySize: 1, unsized: 0 });
        expect(formatTotal(t)).toBe("17 h or more");
    });

    it("writes a total as a range, or as one number when both ends agree", () => {
        expect(formatTotal({ low: 12, high: 20, bySize: 0, unsized: 0 })).toBe("12–20 h");
        expect(formatTotal({ low: 3, high: 3, bySize: 0, unsized: 0 })).toBe("3 h");
    });
});

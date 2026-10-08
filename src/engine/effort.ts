import type { Hours } from "./types";

/** What each size means; a working day is 8 hours, so "up to 2 days" is 16. */
export const SIZES = [
    { size: "S", span: "up to 2 hours", upTo: 2 },
    { size: "M", span: "up to 2 days", upTo: 16 },
    { size: "L", span: "over 2 days", upTo: null }
] as const;

export type Size = (typeof SIZES)[number]["size"];

/** The hours a size alone stands for in a total; a large finding has no upper end. */
const BY_SIZE: Record<Size, { low: number; high: number | null }> = {
    S: { low: 1, high: 2 },
    M: { low: 2, high: 16 },
    L: { low: 16, high: null }
};

/** By the range's high end, so the letter never contradicts the hours. */
export function sizeOf(h: Hours): Size {
    return SIZES.find(s => s.upTo === null || h.high <= s.upTo)!.size;
}

export function hoursError(h: Hours): string | null {
    if (!Number.isInteger(h.low) || !Number.isInteger(h.high)) return "Hours are whole numbers.";
    if (h.low < 1) return "Hours start from 1.";
    if (h.low > h.high) return "The low end of the hours is above the high end.";
    // The column is a 4-byte integer, and a fix this large is several findings.
    if (h.high > 999) return "Over 999 hours is not one fix; split the finding.";
    return null;
}

/** The editor's two fields; one end alone is a single number. */
export const hoursFrom = (low: string | null, high: string | null): Hours | null =>
    low || high ? { low: Number(low ?? high), high: Number(high ?? low) } : null;

export const formatHours = (h: Hours) => (h.low === h.high ? `${h.low} h` : `${h.low}–${h.high} h`);

export interface Total {
    low: number;
    /** Null when a large finding without hours leaves the total open-ended. */
    high: number | null;
    /** Findings counted at their size's range, having no hours. */
    bySize: number;
    /** Findings with neither, left out of the total. */
    unsized: number;
}

export function totalHours(findings: { effort: string | null; effortHours: Hours | null }[]): Total {
    const t: Total = { low: 0, high: 0, bySize: 0, unsized: 0 };
    for (const f of findings) {
        const h = f.effortHours ?? (f.effort ? BY_SIZE[f.effort as Size] : null);
        if (!h) {
            t.unsized++;
            continue;
        }
        if (!f.effortHours) t.bySize++;
        t.low += h.low;
        t.high = t.high === null || h.high === null ? null : t.high + h.high;
    }
    return t;
}

export const formatTotal = (t: Total) => (t.high === null ? `${t.low} h or more` : formatHours({ low: t.low, high: t.high }));

/** The ranges a finding with only a size counts at, for the report's note. */
export const BY_SIZE_TEXT = SIZES.map(s => {
    const h = BY_SIZE[s.size];
    return `${s.size} at ${h.high === null ? `${h.low} h or more` : formatHours({ low: h.low, high: h.high })}`;
});

/** A finding row's two columns as a range; both are set together or neither. */
export const hoursOf = (r: { effortHoursLow: number | null; effortHoursHigh: number | null }): Hours | null =>
    r.effortHoursLow != null && r.effortHoursHigh != null ? { low: r.effortHoursLow, high: r.effortHoursHigh } : null;

/** For the review list: the size, and the hours beside it when set. */
export const sizeAndHours = (effort: string, h: Hours | null) => (h ? `${effort} · ${formatHours(h)}` : effort);

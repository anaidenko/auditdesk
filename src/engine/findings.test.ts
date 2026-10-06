import { describe, expect, it } from "vitest";

import { compareFindings, findingLabel, fingerprint, indexLine } from "./findings";

describe("findings", () => {
    it("labels numbers with three digits and grows past 999", () => {
        expect(findingLabel(12)).toBe("F-012");
        expect(findingLabel(1000)).toBe("F-1000");
    });

    it("fingerprints the same issue the same way whatever the whitespace", () => {
        const a = {
            repositoryId: "r",
            aspect: "security",
            checklistItem: "SEC-03",
            evidence: [{ file: "a.ts", startLine: 1, endLine: 2, snippet: "x  =  1" }]
        };
        const b = { ...a, evidence: [{ file: "a.ts", startLine: 40, endLine: 41, snippet: "x = 1" }] };
        expect(fingerprint(a)).toBe(fingerprint(b));
    });

    it("writes one index line per finding", () => {
        const f = {
            label: "F-003",
            severity: "high" as const,
            checklistItem: "SEC-04",
            evidence: [{ file: "a.ts", startLine: 9, endLine: 9 }],
            title: "Raw SQL"
        };
        expect(indexLine(f)).toBe("F-003 [high] SEC-04 a.ts:9 Raw SQL");
    });

    it("sorts by severity, then aspect, then number", () => {
        const rows = [
            { severity: "low", aspect: "security", number: 1 },
            { severity: "critical", aspect: "security", number: 3 },
            { severity: null, aspect: "security", number: 2 },
            { severity: "critical", aspect: "architecture", number: 4 }
        ] as const;
        expect([...rows].sort(compareFindings).map(r => r.number)).toEqual([4, 3, 1, 2]);
    });
});

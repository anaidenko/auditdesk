import { describe, expect, it } from "vitest";

import { compareFindings, findingLabel, fingerprint, indexLine, scannerDuplicates } from "./findings";

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

    it("sorts by severity, then the catalogue's aspect order, then number", () => {
        const rows = [
            { severity: "low", aspect: "security", number: 1 },
            { severity: "critical", aspect: "security", number: 3 },
            { severity: null, aspect: "security", number: 2 },
            { severity: "critical", aspect: "architecture", number: 4 }
        ] as const;
        expect([...rows].sort(compareFindings).map(r => r.number)).toEqual([3, 4, 1, 2]);
    });

    it("orders findings of one severity by the catalogue's aspects, whether named by key or title", () => {
        const f = (aspect: string, number: number) => ({ severity: "high" as const, aspect, number });
        const keys = [f("tenancy", 1), f("security", 2), f("quality", 3), f("data", 4), f("legacy", 5)];
        expect(keys.sort(compareFindings).map(x => x.aspect)).toEqual(["security", "data", "quality", "tenancy", "legacy"]);
        const titles = [f("Code quality and tests", 1), f("Security", 2), f("Data model and database", 3)];
        expect(titles.sort(compareFindings).map(x => x.aspect)).toEqual(["Security", "Data model and database", "Code quality and tests"]);
    });
});

describe("indexLine", () => {
    it("names every place of a scanner finding of several, up to ten, so an agent does not file them again", () => {
        const places = Array.from({ length: 12 }, (_, i) => ({ file: `src/f${i}.js`, startLine: i + 1, endLine: i + 1, key: `k${i}` }));
        const line = indexLine({
            label: "F-001",
            severity: "critical",
            checklistItem: "SEC-10",
            evidence: places,
            title: "Secrets in the code: 12 generic API keys in 12 files"
        });
        expect(line).toBe(
            `F-001 [critical] SEC-10 ${places
                .slice(0, 10)
                .map(p => `${p.file}:${p.startLine}`)
                .join(", ")} and 2 more Secrets in the code: 12 generic API keys in 12 files`
        );
        const agent = indexLine({
            label: "F-002",
            severity: "high",
            checklistItem: "SEC-04",
            evidence: [
                { file: "a.ts", startLine: 3, endLine: 4 },
                { file: "b.ts", startLine: 1, endLine: 1 }
            ],
            title: "Raw SQL"
        });
        expect(agent).toBe("F-002 [high] SEC-04 a.ts:3 Raw SQL");
    });
});

describe("scannerDuplicates", () => {
    const f = (label: string, source: "agent" | "scanner", item: string, file: string, start: number, end = start) => ({
        label,
        source,
        kind: "finding" as const,
        checklistItem: item,
        evidence: [{ file, startLine: start, endLine: end }]
    });

    it("folds a scanner finding of several places only into an agent finding that covers each", () => {
        const grouped = {
            ...f("F-004", "scanner", "SEC-04", "src/a.js", 7),
            evidence: [
                { file: "src/a.js", startLine: 7, endLine: 7 },
                { file: "src/b.js", startLine: 3, endLine: 3 }
            ]
        };
        const one = f("F-005", "agent", "SEC-04", "src/a.js", 7);
        const both = {
            ...f("F-006", "agent", "SEC-04", "src/a.js", 5, 9),
            evidence: [
                { file: "src/a.js", startLine: 5, endLine: 9 },
                { file: "src/b.js", startLine: 1, endLine: 4 }
            ]
        };
        expect(scannerDuplicates([one], [grouped])).toEqual([]);
        expect(scannerDuplicates([one, both], [grouped])).toEqual([{ from: "F-004", into: "F-006" }]);
    });

    it("pairs a scanner finding with an agent finding on overlapping lines of one file under one item", () => {
        const agent = [f("F-005", "agent", "SEC-04", "src/server.js", 7)];
        const scanner = [
            f("F-004", "scanner", "SEC-04", "src/server.js", 7),
            f("F-003", "scanner", "SEC-05", "src/server.js", 7),
            f("F-006", "scanner", "SEC-04", "src/server.js", 9),
            f("F-007", "scanner", "SEC-04", "src/other.js", 7)
        ];
        expect(scannerDuplicates(agent, scanner)).toEqual([{ from: "F-004", into: "F-005" }]);
    });

    it("folds a scanner finding into the narrowest agent finding that covers it, and never into a question", () => {
        const agent = [f("F-005", "agent", "SEC-04", "a.js", 5, 9), f("F-006", "agent", "SEC-04", "a.js", 7)];
        const question = { ...f("F-008", "agent", "SEC-04", "a.js", 7), kind: "question" as const };
        expect(scannerDuplicates([question, ...agent], [f("F-004", "scanner", "SEC-04", "a.js", 7)])).toEqual([
            { from: "F-004", into: "F-006" }
        ]);
    });

    it("folds nothing into an agent finding that cites a range wider than the grader trusts", () => {
        const wide = f("F-020", "agent", "SEC-04", "routes/search.ts", 1, 120);
        expect(scannerDuplicates([wide], [f("F-004", "scanner", "SEC-04", "routes/search.ts", 23)])).toEqual([]);
    });

    it("keeps apart two findings that name different weaknesses", () => {
        const agent = { ...f("F-020", "agent", "SEC-04", "a.js", 20, 30), cwe: "CWE-89" };
        const sql = { ...f("F-004", "scanner", "SEC-04", "a.js", 23), cwe: "CWE-89" };
        const evalCall = { ...f("F-006", "scanner", "SEC-04", "a.js", 28), cwe: "CWE-95" };
        const unnamed = f("F-007", "scanner", "SEC-04", "a.js", 25);
        expect(scannerDuplicates([agent], [sql, evalCall, unnamed])).toEqual([
            { from: "F-004", into: "F-020" },
            { from: "F-007", into: "F-020" }
        ]);
    });
});

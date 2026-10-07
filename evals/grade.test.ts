import { describe, expect, it } from "vitest";

import type { AnswerKey, KeyEntry } from "./fixtures";
import { type GradedFinding, grade } from "./grade";

const entry = (over: Partial<KeyEntry> & Pick<KeyEntry, "id">): KeyEntry => ({
    aspect: "security",
    checklistItem: "SEC-03",
    kind: "finding",
    severity: "high",
    title: "t",
    file: "src/orders.ts",
    startLine: 8,
    endLine: 11,
    anchor: "a",
    ...over
});

const finding = (over: Partial<GradedFinding> & Pick<GradedFinding, "label">): GradedFinding => ({
    kind: "finding",
    source: "agent",
    aspect: "security",
    checklistItem: "SEC-03",
    title: "t",
    evidence: [{ file: "src/orders.ts", startLine: 9, endLine: 9 }],
    ...over
});

const key = (entries: KeyEntry[], known: AnswerKey["known"] = []): AnswerKey => ({ fixture: "own", entries, known });

describe("grade", () => {
    it("matches a finding on file, overlapping lines and checklist item", () => {
        const g = grade(
            [finding({ label: "F-001", evidence: [{ file: "src/orders.ts", startLine: 14, endLine: 20 }] })],
            key([entry({ id: "K1" })])
        );
        expect(g.matched).toEqual([{ key: "K1", finding: "F-001" }]);
        expect(g.leftovers).toEqual([]);
    });

    it("does not match past the slack, or in another file", () => {
        const g = grade(
            [
                finding({ label: "F-001", evidence: [{ file: "src/orders.ts", startLine: 15, endLine: 20 }] }),
                finding({ label: "F-002", evidence: [{ file: "src/other.ts", startLine: 9, endLine: 9 }] })
            ],
            key([entry({ id: "K1" })])
        );
        expect(g.matched).toEqual([]);
        expect(g.leftovers).toEqual(["F-001", "F-002"]);
    });

    it("credits a finding to the nearest entry when two lie within the slack, and to each place it cites", () => {
        const k = key([entry({ id: "K1", startLine: 5, endLine: 5 }), entry({ id: "K2", startLine: 7, endLine: 7 })]);
        const g = grade(
            [
                finding({ label: "F-001", evidence: [{ file: "src/orders.ts", startLine: 5, endLine: 5 }] }),
                finding({ label: "F-002", checklistItem: "SEC-05", evidence: [{ file: "src/orders.ts", startLine: 7, endLine: 7 }] }),
                finding({
                    label: "F-003",
                    evidence: [
                        { file: "src/orders.ts", startLine: 5, endLine: 5 },
                        { file: "src/orders.ts", startLine: 7, endLine: 7 }
                    ]
                })
            ],
            k
        );
        expect(g.matched).toEqual([
            { key: "K1", finding: "F-001" },
            { key: "K1", finding: "F-003" },
            { key: "K2", finding: "F-003" }
        ]);
        expect(g.locationOnly).toEqual([{ key: "K2", finding: "F-002", item: "SEC-05" }]);
    });

    it("counts a match on location with the wrong item separately, not as found", () => {
        const g = grade([finding({ label: "F-001", checklistItem: "SEC-05" })], key([entry({ id: "K1" })]));
        expect(g.matched).toEqual([]);
        expect(g.locationOnly).toEqual([{ key: "K1", finding: "F-001", item: "SEC-05" }]);
        expect(g.leftovers).toEqual([]);
        expect(g.recall).toBe(0);
    });

    it("accepts an item another aspect owns, and a place the defect also shows", () => {
        const k = key([
            entry({
                id: "K1",
                alsoItems: ["SEC-16"],
                also: [{ file: "src/page.tsx", startLine: 26, endLine: 26, anchor: "b" }]
            })
        ]);
        const g = grade(
            [finding({ label: "F-001", checklistItem: "SEC-16", evidence: [{ file: "src/page.tsx", startLine: 26, endLine: 26 }] })],
            k
        );
        expect(g.matched).toEqual([{ key: "K1", finding: "F-001" }]);
    });

    it("counts a key entry once when two findings hit it", () => {
        const g = grade(
            [finding({ label: "F-001" }), finding({ label: "F-002" })],
            key([entry({ id: "K1" }), entry({ id: "K2", file: "x.ts" })])
        );
        expect(g.matched).toEqual([
            { key: "K1", finding: "F-001" },
            { key: "K1", finding: "F-002" }
        ]);
        expect(g.found).toBe(1);
        expect(g.recall).toBe(0.5);
    });

    it("matches an absence by its item in any file, and a question entry only by a question", () => {
        const k = key([
            entry({ id: "K1", kind: "absence", checklistItem: "PRD-04", file: undefined, startLine: undefined, endLine: undefined }),
            entry({ id: "K2", kind: "question", checklistItem: "PRD-07", severity: null, file: undefined, startLine: undefined })
        ]);
        const g = grade(
            [
                finding({
                    label: "F-001",
                    aspect: "production",
                    checklistItem: "PRD-04",
                    evidence: [{ file: "any.ts", startLine: 1, endLine: 1 }]
                }),
                finding({ label: "F-002", aspect: "production", checklistItem: "PRD-07", evidence: [] }),
                finding({ label: "F-003", aspect: "production", kind: "question", checklistItem: "PRD-07", evidence: [] })
            ],
            k
        );
        expect(g.matched).toEqual([
            { key: "K1", finding: "F-001" },
            { key: "K2", finding: "F-003" }
        ]);
        expect(g.leftovers).toEqual(["F-002"]);
    });

    it("leaves an unmatched finding to the judge", () => {
        const g = grade(
            [finding({ label: "F-001", checklistItem: "SEC-09", evidence: [{ file: "src/auth.ts", startLine: 3, endLine: 4 }] })],
            key([entry({ id: "K1" })])
        );
        expect(g.leftovers).toEqual(["F-001"]);
    });

    it("keeps questions out of the false-finding count", () => {
        const g = grade([finding({ label: "F-001", kind: "question", checklistItem: "SEC-09", evidence: [] })], key([entry({ id: "K1" })]));
        expect(g.leftovers).toEqual([]);
        expect(g.questionsIgnored).toBe(1);
    });

    it("sets aside a finding on a known issue, in its file when the key names one", () => {
        const k = key(
            [entry({ id: "K1" })],
            [
                { checklistItem: "QUA-02", title: "No tests" },
                { checklistItem: "SEC-12", title: "No rate limit on login", file: "src/login.ts" }
            ]
        );
        const g = grade(
            [
                finding({ label: "F-001", aspect: "quality", checklistItem: "QUA-02", evidence: [] }),
                finding({ label: "F-002", checklistItem: "SEC-12", evidence: [{ file: "src/login.ts", startLine: 5, endLine: 5 }] }),
                finding({ label: "F-003", checklistItem: "SEC-12", evidence: [{ file: "src/signup.ts", startLine: 5, endLine: 5 }] })
            ],
            k
        );
        expect(g.known).toEqual(["F-001", "F-002"]);
        expect(g.leftovers).toEqual(["F-003"]);
    });

    it("takes a known issue beside a planted entry of another item as known, not as a misplaced find", () => {
        const k = key(
            [entry({ id: "K1", aspect: "performance", checklistItem: "PRF-04", file: "src/search.tsx", startLine: 17, endLine: 21 })],
            [{ checklistItem: "ARC-03", title: "A failed request is never handled", file: "src/search.tsx" }]
        );
        const g = grade(
            [
                finding({
                    label: "F-001",
                    aspect: "architecture",
                    checklistItem: "ARC-03",
                    evidence: [{ file: "src/search.tsx", startLine: 18, endLine: 20 }]
                })
            ],
            k
        );
        expect(g.known).toEqual(["F-001"]);
        expect(g.locationOnly).toEqual([]);
        expect(g.leftovers).toEqual([]);
    });

    it("computes recall over the entries the run's aspects could find, and names the missed ones", () => {
        const k = key([
            entry({ id: "K1" }),
            entry({ id: "K2", file: "b.ts" }),
            entry({ id: "K3", aspect: "llm", checklistItem: "LLM-01", file: "c.ts" }),
            entry({ id: "K4", aspect: "data", checklistItem: "DAT-02", alsoItems: ["SEC-04"], file: "d.ts" })
        ]);
        const g = grade([finding({ label: "F-001" })], k, { aspects: ["security"] });
        expect(g.total).toBe(3);
        expect(g.found).toBe(1);
        expect(g.recall).toBeCloseTo(1 / 3);
        expect(g.missed).toEqual(["K2", "K4"]);
        expect(g.scoped).toEqual(["K1", "K2", "K4"]);
    });

    it("grades only the findings of the run's aspects, and lists the rest as outside it", () => {
        const k = key([
            entry({ id: "K1" }),
            entry({ id: "K2", aspect: "dependencies", checklistItem: "DEP-01", file: "package-lock.json" })
        ]);
        const g = grade(
            [
                finding({ label: "F-001" }),
                finding({
                    label: "F-002",
                    aspect: "dependencies",
                    checklistItem: "DEP-01",
                    evidence: [{ file: "package-lock.json", startLine: 9, endLine: 9 }]
                }),
                finding({ label: "F-003", aspect: "dependencies", checklistItem: "DEP-02", evidence: [] })
            ],
            k,
            { aspects: ["security"] }
        );
        expect(g.matched).toEqual([{ key: "K1", finding: "F-001" }]);
        expect(g.outside).toEqual(["F-002", "F-003"]);
        expect(g.leftovers).toEqual([]);
    });

    it("credits a range of more than 30 lines only through the judge", () => {
        const g = grade(
            [finding({ label: "F-001", evidence: [{ file: "src/orders.ts", startLine: 1, endLine: 400 }] })],
            key([entry({ id: "K1" }), entry({ id: "K2", startLine: 90, endLine: 90 })])
        );
        expect(g.matched).toEqual([]);
        expect(g.leftovers).toEqual(["F-001"]);
    });

    it("counts a scanner finding folded into an agent's as found by the scanner, and never as a leftover", () => {
        const g = grade(
            [
                finding({ label: "F-001", source: "scanner", folded: true }),
                finding({
                    label: "F-002",
                    source: "scanner",
                    folded: true,
                    checklistItem: "SEC-09",
                    evidence: [{ file: "z.ts", startLine: 1, endLine: 1 }]
                }),
                finding({ label: "F-003", source: "scanner", folded: true, checklistItem: "SEC-05" })
            ],
            key([entry({ id: "K1" })])
        );
        expect(g.matched).toEqual([{ key: "K1", finding: "F-001" }]);
        expect(g.leftovers).toEqual([]);
        expect(g.locationOnly).toEqual([]);
    });

    it("counts what the agents found apart from what the scanners found", () => {
        const g = grade(
            [
                finding({ label: "F-001", source: "scanner" }),
                finding({ label: "F-002", evidence: [{ file: "b.ts", startLine: 8, endLine: 8 }] })
            ],
            key([entry({ id: "K1" }), entry({ id: "K2", file: "b.ts" }), entry({ id: "K3", file: "c.ts" })])
        );
        expect(g.found).toBe(2);
        expect(g.foundByAgents).toBe(1);
    });
});

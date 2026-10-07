import { describe, expect, it } from "vitest";

import { type EarlierFinding, recheck } from "./recheck";

const files: Record<string, string> = {
    "src/search.ts": ["export function search(q) {", "    return db.query(`SELECT * FROM p WHERE name = '${q}'`);", "}"].join("\n"),
    "src/moved.ts": ["// moved and re-indented", "function f() {", "        return eval(input);", "}"].join("\n"),
    "src/long.ts": `const key = "${"x".repeat(300)}";`
};
const read = async (file: string) => files[file]?.split("\n") ?? null;

const earlier = (over: Partial<EarlierFinding>): EarlierFinding => ({
    id: "f1",
    label: "F-001",
    source: "agent",
    fingerprint: "fp-1",
    evidence: [],
    recheck: null,
    ...over
});
const run = (findings: EarlierFinding[], o: { scannerSeen?: string[]; filedNow?: string[] } = {}) =>
    recheck(findings, { scannerSeen: new Set(o.scannerSeen ?? []), filedNow: new Set(o.filedNow ?? []), read });

describe("recheck", () => {
    it("calls a scanner finding fixed when this run's scanners no longer report it, and open when they do", async () => {
        const out = await run(
            [earlier({ id: "a", source: "scanner", fingerprint: "s1" }), earlier({ id: "b", source: "scanner", fingerprint: "s2" })],
            { scannerSeen: ["s1"] }
        );
        expect(out.map(r => [r.id, r.status])).toEqual([
            ["a", "open"],
            ["b", "fixed"]
        ]);
    });

    it("keeps an agent finding open while every cited block is still in its file, re-indented or moved", async () => {
        const [r] = await run([
            earlier({
                evidence: [
                    {
                        file: "src/search.ts",
                        startLine: 2,
                        endLine: 2,
                        snippet: "    return db.query(`SELECT * FROM p WHERE name = '${q}'`);"
                    },
                    { file: "src/moved.ts", startLine: 1, endLine: 2, snippet: "function f() {\n    return eval(input);" }
                ]
            })
        ]);
        expect(r.status).toBe("open");
    });

    it("matches a cited line the snippet cut by its kept start", async () => {
        const snippet = `const key = "${"x".repeat(200)}… [line cut: 316 characters]`.replace("… [", " … [");
        const [r] = await run([earlier({ evidence: [{ file: "src/long.ts", startLine: 1, endLine: 1, snippet }] })]);
        expect(r.status).toBe("open");
    });

    it("calls an agent finding changed, for Andrii to verify, when its cited code is gone or only partly there", async () => {
        const gone = earlier({ id: "gone", evidence: [{ file: "src/search.ts", startLine: 2, endLine: 2, snippet: "return db.raw(q);" }] });
        const deleted = earlier({ id: "deleted", evidence: [{ file: "src/old.ts", startLine: 1, endLine: 1, snippet: "x();" }] });
        const partly = earlier({
            id: "partly",
            evidence: [
                { file: "src/moved.ts", startLine: 3, endLine: 3, snippet: "return eval(input);" },
                { file: "src/search.ts", startLine: 9, endLine: 9, snippet: "gone();" }
            ]
        });
        const unsnipped = earlier({ id: "unsnipped", evidence: [{ file: "src/search.ts", startLine: 1, endLine: 1 }] });
        expect((await run([gone, deleted, partly, unsnipped])).map(r => r.status)).toEqual(["changed", "changed", "changed", "changed"]);
    });

    it("keeps an agent finding open when this run's agent filed it again", async () => {
        const [r] = await run(
            [earlier({ fingerprint: "fp-9", evidence: [{ file: "src/x.ts", startLine: 1, endLine: 1, snippet: "y" }] })],
            {
                filedNow: ["fp-9"]
            }
        );
        expect(r.status).toBe("open");
    });

    it("keeps a finding confirmed fixed as fixed, and calls it regressed when its code or its scanner result is back", async () => {
        const out = await run(
            [
                earlier({
                    id: "stays",
                    recheck: "fixed",
                    evidence: [{ file: "src/search.ts", startLine: 1, endLine: 1, snippet: "gone();" }]
                }),
                earlier({
                    id: "back",
                    recheck: "fixed",
                    evidence: [{ file: "src/moved.ts", startLine: 3, endLine: 3, snippet: "return eval(input);" }]
                }),
                earlier({ id: "leak", source: "scanner", fingerprint: "s1", recheck: "fixed" })
            ],
            { scannerSeen: ["s1"] }
        );
        expect(out.map(r => [r.id, r.status])).toEqual([
            ["stays", "fixed"],
            ["back", "regressed"],
            ["leak", "regressed"]
        ]);
    });
});

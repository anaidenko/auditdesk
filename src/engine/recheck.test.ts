import { describe, expect, it } from "vitest";

import { snippetOf } from "./files";
import { type EarlierFinding, recheck } from "./recheck";
import type { NewFinding } from "./types";

const files: Record<string, string> = {
    "src/search.ts": ["export function search(q) {", "", "    return db.query(`SELECT * FROM p WHERE name = '${q}'`);", "}"].join("\n"),
    "src/moved.ts": ["// moved down", "", "function calc() {", "        return run(String(input.expression));", "}"].join("\n"),
    "src/user.ts": ['const q = "SELECT * FROM users WHERE id = " + id;', "res.json(user);", "res.json(user);"].join("\n"),
    "src/long.ts": `const key = "${"x".repeat(2500)}";`
};
const read = async (file: string) => files[file]?.split("\n") ?? null;

const earlier = (over: Partial<EarlierFinding>): EarlierFinding => ({
    id: "f1",
    label: "F-001",
    source: "agent",
    fingerprint: "fp-1",
    title: "t",
    checklistItem: "SEC-04",
    references: {},
    evidence: [],
    recheck: null,
    recheckDigest: null,
    recheckGone: false,
    ...over
});
const scanned = (over: Partial<NewFinding>): NewFinding => ({
    repositoryId: "r",
    agentRunId: null,
    aspect: "security",
    kind: "finding",
    checklistItem: "SEC-15",
    title: "t",
    severity: "medium",
    likelihood: null,
    impact: null,
    summary: "s",
    explanation: "e",
    recommendation: "r",
    effort: "S",
    references: {},
    tags: [],
    source: "scanner",
    fingerprint: "s1",
    evidence: [{ file: "src/search.ts", startLine: 3, endLine: 3, snippet: "x" }],
    ...over
});
const run = (findings: EarlierFinding[], scanners: NewFinding[] = []) => recheck(findings, { scanners, read });
const status = async (findings: EarlierFinding[], scanners: NewFinding[] = []) => (await run(findings, scanners)).map(r => r.status);

const evalBlock = {
    file: "src/moved.ts",
    startLine: 1,
    endLine: 2,
    snippet: "function calc() {\n    return run(String(input.expression));"
};

describe("recheck", () => {
    it("calls an agent finding's code unchanged while every cited block is still in its file, and moves its lines", async () => {
        const [r] = await run([earlier({ evidence: [evalBlock] })]);
        expect(r.status).toBe("unchanged");
        expect(r.evidence).toEqual([{ ...evalBlock, startLine: 3, endLine: 4 }]);
    });

    it("matches a line however its spaces changed", async () => {
        const snippet = 'const q = "SELECT * FROM users WHERE id = "+id;';
        expect(await status([earlier({ evidence: [{ file: "src/user.ts", startLine: 1, endLine: 1, snippet }] })])).toEqual(["unchanged"]);
    });

    it("matches a line the snippet cut by the start it kept", async () => {
        const snippet = snippetOf(files["src/long.ts"].split("\n"), 1, 1);
        expect(snippet).toMatch(/line cut/);
        expect(await status([earlier({ evidence: [{ file: "src/long.ts", startLine: 1, endLine: 1, snippet }] })])).toEqual(["unchanged"]);
    });

    it("calls the code changed when a cited block is gone, partly there, too short to tell or longer than its snippet", async () => {
        const at = (file: string, snippet: string, startLine = 1, endLine = startLine) => ({ file, startLine, endLine, snippet });
        expect(
            await status([
                earlier({ evidence: [at("src/search.ts", "return db.raw(q);")] }),
                earlier({ evidence: [at("src/old.ts", "x();")] }),
                earlier({ evidence: [evalBlock, at("src/search.ts", "gone();")] }),
                earlier({ evidence: [at("src/user.ts", "res.json(user);", 2)] }),
                earlier({ evidence: [at("src/search.ts", "export function search(q) {", 1, 40)] }),
                earlier({ evidence: [{ file: "src/search.ts", startLine: 1, endLine: 1 }] })
            ])
        ).toEqual(["changed", "changed", "changed", "changed", "changed", "changed"]);
    });

    it("keeps a scanner finding open while its scanner reports it, and changed when the report about it changed", async () => {
        const leak = earlier({ source: "scanner", checklistItem: "SEC-10", title: "Secret in the code: AWS key", fingerprint: "g1" });
        expect(await status([leak], [scanned({ fingerprint: "g1", title: "Secret in the code: AWS key" })])).toEqual(["unchanged"]);
        // Removed from the code, still in the history: the same secret, but the report it gave is no longer true.
        expect(await status([leak], [scanned({ fingerprint: "g1", title: "Secret in git history: AWS key" })])).toEqual(["changed"]);
    });

    it("never calls a secret fixed by itself: no scan can tell it was rotated", async () => {
        const leak = earlier({ source: "scanner", checklistItem: "SEC-10", title: "Secret in git history: AWS key", fingerprint: "g1" });
        expect(await status([leak])).toEqual(["changed"]);
    });

    it("calls a dependency fixed once no lock file reports its advisories, and changed when another one still does", async () => {
        const dep = earlier({
            source: "scanner",
            checklistItem: "DEP-01",
            title: "lodash 4.17.15: 1 known vulnerability",
            fingerprint: "o1",
            references: { advisories: ["GHSA-1"] }
        });
        expect(await status([dep])).toEqual(["fixed"]);
        expect(
            await status([dep], [scanned({ checklistItem: "DEP-01", fingerprint: "o2", references: { advisories: ["GHSA-1", "GHSA-2"] } })])
        ).toEqual(["changed"]);
    });

    it("calls a Semgrep finding fixed once its code is gone, and changed when the code is there but the rule no longer reports it", async () => {
        const rule = (snippet: string) =>
            earlier({ source: "scanner", fingerprint: "s9", evidence: [{ file: "src/moved.ts", startLine: 2, endLine: 2, snippet }] });
        expect(await status([rule("return eval(input);")])).toEqual(["fixed"]);
        expect(await status([rule("return run(String(input.expression));")])).toEqual(["changed"]);
        // Reported again in a renamed file: the same code, moved.
        expect(
            await status(
                [rule("return eval(input);")],
                [
                    scanned({
                        fingerprint: "s10",
                        checklistItem: "SEC-04",
                        evidence: [{ file: "src/new.ts", startLine: 1, endLine: 1, snippet: "return eval(input);" }]
                    })
                ]
            )
        ).toEqual(["changed"]);
    });

    it("keeps Andrii's fix while the cited code stays, and calls it regressed only when it was gone and came back", async () => {
        const fixedWhilePresent = earlier({ recheck: "fixed", recheckGone: false, evidence: [evalBlock] });
        const [kept] = await run([fixedWhilePresent]);
        expect(kept).toMatchObject({ status: "fixed", keep: true, gone: false });
        const gone = earlier({ recheck: "fixed", evidence: [{ ...evalBlock, snippet: "return eval(input);" }] });
        const [marked] = await run([gone]);
        expect(marked).toMatchObject({ status: "fixed", keep: true, gone: true });
        const [back] = await run([{ ...fixedWhilePresent, recheckGone: true }]);
        expect(back.status).toBe("regressed");
    });

    it("keeps Andrii's call that a finding is still open until its code changes again", async () => {
        const [first] = await run([earlier({ evidence: [{ ...evalBlock, snippet: "return eval(input);" }] })]);
        expect(first.status).toBe("changed");
        const open = earlier({
            recheck: "open",
            recheckDigest: first.digest,
            evidence: [{ ...evalBlock, snippet: "return eval(input);" }]
        });
        expect(await status([open])).toEqual(["open"]);
        expect(await status([{ ...open, recheckDigest: "another" }])).toEqual(["changed"]);
    });
});

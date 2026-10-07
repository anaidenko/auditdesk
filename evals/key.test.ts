import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { buildKey, keyYaml } from "./key";
import { stripAnswers } from "./prep/strip";

const APP = [
    "const db = require('./db')", //                                                                    1
    "// vuln-code-snippet start loginChallenge searchChallenge", //                                     2
    "app.post('/login', (req) => {", //                                                                 3
    "  db.query(`SELECT * FROM Users WHERE email = '${req.body.email}'`) // vuln-code-snippet vuln-line loginChallenge", // 4
    "  db.query(`AND password = '${req.body.password}'`) // vuln-code-snippet vuln-line loginChallenge", // 5
    "})", //                                                                                             6
    "app.get('/search', (req) => db.query(`SELECT * FROM Products WHERE name LIKE '%${req.query.q}%'`)) // vuln-code-snippet vuln-line searchChallenge", // 7
    "app.get('/x', () => 1)", //                                                                          8
    "app.get('/y', (req) => db.query(`SELECT ${req.query.c}`)) // vuln-code-snippet vuln-line searchChallenge", // 9
    "// vuln-code-snippet end loginChallenge searchChallenge", //                                       10
    ""
].join("\n");

const MAP = {
    loginChallenge: { aspect: "security", checklistItem: "SEC-04", severity: "critical" as const, title: "SQL injection in login" },
    searchChallenge: { aspect: "security", checklistItem: "SEC-04", severity: "high" as const, title: "SQL injection in search" }
};

async function prepared() {
    const tree = await makeRepo({ "routes/app.js": APP, "notes.sol": "x // vuln-code-snippet vuln-line solidityChallenge\n" });
    const upstream = readFileSync(`${tree}/routes/app.js`, "utf8");
    const { lineMap } = await stripAnswers(tree, { deletePaths: [], statementPatterns: [] });
    return { tree, lineMap, upstream: { "routes/app.js": upstream, "notes.sol": "x // vuln-code-snippet vuln-line solidityChallenge\n" } };
}

describe("buildKey", () => {
    it("turns vuln-line markers into key entries in prepared line numbers, anchored on the prepared code", async () => {
        const { tree, lineMap, upstream } = await prepared();
        const key = buildKey(upstream, lineMap, MAP, tree);
        const login = key.find(e => e.id === "JS-loginChallenge")!;
        expect(login).toMatchObject({
            checklistItem: "SEC-04",
            severity: "critical",
            kind: "finding",
            file: "routes/app.js",
            startLine: 3,
            endLine: 4
        });
        const lines = readFileSync(`${tree}/routes/app.js`, "utf8").split("\n");
        expect(lines[login.startLine! - 1]).toContain(login.anchor);
    });

    it("merges consecutive marked lines of one challenge into one range, and keeps a distant one as another place", async () => {
        const { tree, lineMap, upstream } = await prepared();
        const search = buildKey(upstream, lineMap, MAP, tree).find(e => e.id === "JS-searchChallenge")!;
        expect([search.startLine, search.endLine]).toEqual([6, 6]);
        expect(search.also?.map(l => [l.startLine, l.endLine])).toEqual([[8, 8]]);
    });

    it("refuses a challenge that the challenge map does not cover, naming it", async () => {
        const { tree, lineMap, upstream } = await prepared();
        expect(() => buildKey(upstream, lineMap, { loginChallenge: MAP.loginChallenge }, tree)).toThrow(/searchChallenge/);
    });

    it("keys challenges marked on the same lines under one item as one defect", async () => {
        const tree = await makeRepo({ "routes/login.js": "db.query(q) // vuln-code-snippet vuln-line adminChallenge benderChallenge\n" });
        const upstream = { "routes/login.js": readFileSync(`${tree}/routes/login.js`, "utf8") };
        const { lineMap } = await stripAnswers(tree, { deletePaths: [], statementPatterns: [] });
        const map = {
            adminChallenge: { ...MAP.loginChallenge, title: "SQL injection in the login query" },
            benderChallenge: { ...MAP.loginChallenge, title: "SQL injection in the login query" }
        };
        const key = buildKey(upstream, lineMap, map, tree);
        expect(key.map(e => e.id)).toEqual(["JS-adminChallenge+benderChallenge"]);
        expect(key[0]).toMatchObject({ file: "routes/login.js", startLine: 1, endLine: 1, checklistItem: "SEC-04" });
    });

    it("refuses a mapped challenge whose marked lines the prep removed, with its file or alone", async () => {
        const files = {
            "routes/app.js": "db.query(q) // vuln-code-snippet vuln-line keptChallenge\n",
            "routes/verify.js": "check() // vuln-code-snippet vuln-line goneChallenge\n",
            "lib/x.js": "x()\nchallengeUtils.solveIf(c, () => {\n  return y // vuln-code-snippet vuln-line solvedChallenge\n})\n"
        };
        const tree = await makeRepo(files);
        const { lineMap } = await stripAnswers(tree, {
            deletePaths: ["routes/verify.js"],
            statementPatterns: [/challengeUtils\.solveIf\(/]
        });
        const challenge = { ...MAP.loginChallenge };
        expect(buildKey(files, lineMap, { keptChallenge: challenge }, tree).map(e => e.id)).toEqual(["JS-keptChallenge"]);
        expect(() =>
            buildKey(files, lineMap, { keptChallenge: challenge, goneChallenge: challenge, solvedChallenge: challenge }, tree)
        ).toThrow(/goneChallenge, solvedChallenge/);
    });

    it("carries a challenge's other items, and keeps challenges on one line apart when their items differ", async () => {
        const tree = await makeRepo({
            "routes/chat.js": "tool(z.number()) // vuln-code-snippet vuln-line injectChallenge greedyChallenge\n"
        });
        const upstream = { "routes/chat.js": readFileSync(`${tree}/routes/chat.js`, "utf8") };
        const { lineMap } = await stripAnswers(tree, { deletePaths: [], statementPatterns: [] });
        const key = buildKey(
            upstream,
            lineMap,
            {
                injectChallenge: { aspect: "llm", checklistItem: "LLM-01", severity: "high", title: "Injection" },
                greedyChallenge: {
                    aspect: "llm",
                    checklistItem: "LLM-02",
                    alsoItems: ["LLM-03"],
                    severity: "medium",
                    title: "Any discount"
                }
            },
            tree
        );
        expect(key.map(e => [e.id, e.checklistItem, e.alsoItems])).toEqual([
            ["JS-greedyChallenge", "LLM-02", ["LLM-03"]],
            ["JS-injectChallenge", "LLM-01", undefined]
        ]);
    });

    it("leaves out a challenge the map marks as no defect, with its reason", async () => {
        const { tree, lineMap, upstream } = await prepared();
        const key = buildKey(
            upstream,
            lineMap,
            { ...MAP, searchChallenge: { ...MAP.searchChallenge, skip: "Not a defect by the fixture's own fix." } },
            tree
        );
        expect(key.map(e => e.id)).toEqual(["JS-loginChallenge"]);
    });

    it("keys only languages v1 covers", async () => {
        const { tree, lineMap, upstream } = await prepared();
        expect(buildKey(upstream, lineMap, MAP, tree).map(e => e.id)).toEqual(["JS-loginChallenge", "JS-searchChallenge"]);
    });

    it("regenerates byte-identical YAML from the same input, naming the trees it was read from", async () => {
        const a = await prepared();
        const b = await prepared();
        const shas = { upstreamSha: "a".repeat(40), preparedSha: "b".repeat(40) };
        const yaml = keyYaml("juice-shop", buildKey(b.upstream, b.lineMap, MAP, b.tree), shas);
        expect(yaml).toBe(keyYaml("juice-shop", buildKey(a.upstream, a.lineMap, MAP, a.tree), shas));
        expect(yaml).toContain(`upstreamSha: ${"a".repeat(40)}`);
        expect(yaml).toContain(`preparedSha: ${"b".repeat(40)}`);
    });
});

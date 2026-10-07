import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { type StripRules, commitPrepared, stripAnswers } from "./strip";

const LOGIN = [
    "import { challenges } from '../data'",
    "import * as verify from './verify'",
    "// vuln-code-snippet start loginAdminChallenge",
    "export function login (req, res) {",
    "  verifyPreLoginChallenges(req) // vuln-code-snippet hide-line",
    "  db.query(`SELECT * FROM Users WHERE email = '${req.body.email}'`) // vuln-code-snippet vuln-line loginAdminChallenge",
    "  challengeUtils.solveIf(challenges.loginAdminChallenge, () => {",
    "    return req.body.email === 'admin'",
    "  })",
    "  // vuln-code-snippet hide-start",
    "  session.touch(req)",
    "  // vuln-code-snippet hide-end",
    "  if (challengeUtils.notSolved(challenges.scoreBoardChallenge)) {",
    "    if (req.query.board) {",
    "      challengeUtils.solve(challenges.scoreBoardChallenge)",
    "    }",
    "  }",
    "  app.use(verify.jwtChallenges()) // vuln-code-snippet hide-line",
    "  socket.on('verifyLoginAdminChallenge', (data) => {",
    "    log(data)",
    "  })",
    "  res.json({ ok: true, enabled: isChallengeEnabled(challenges.scoreBoardChallenge) })",
    "}",
    "// vuln-code-snippet end loginAdminChallenge",
    ""
].join("\n");

const KEYS = ["export const CHALLENGE_KEYS = [", "  'loginAdminChallenge',", "  'scoreBoardChallenge'", "]", ""].join("\n");

const RULES: StripRules = {
    deletePaths: ["data/static/codefixes/", "test/", "data/static/challenges.yml", "routes/verify.ts", "frontend/**/*.spec.ts"],
    statementPatterns: [
        /\bchallengeUtils\.solveIf\(/,
        /\bverify\w*Challenges\(/,
        /(?<![\w.])verify\.\w+\(/,
        /\bsocket\.on\(\s*['"]verify\w*['"]/
    ],
    blockPatterns: [/^\s*if \(challengeUtils\.notSolved\(/],
    keyLine: /^\s*['"`]\w+Challenge['"`],?\s*$/,
    keys: { file: "data/static/challenges.yml", pattern: /^\s*-?\s*key:\s*(\w+)\s*$/gm }
};

const FILES = {
    "routes/login.ts": LOGIN,
    "routes/verify.ts": "export function jwtChallenges () { return () => {} }\n",
    "models/challenge.ts": KEYS,
    "data/static/codefixes/loginAdminChallenge_1_correct.ts": "fixed\n",
    "data/static/challenges.yml": "- key: loginAdminChallenge\n- key: scoreBoardChallenge\n",
    "test/login.spec.ts": "it('solves the login challenge')\n",
    "frontend/src/app/login.component.spec.ts": "it('passes the search query as trusted HTML')\n",
    "frontend/src/app/login.component.ts": "export class Login {}\n",
    "README.md": "A shop.\n"
};

async function tree(extra: Record<string, string> = {}) {
    return makeRepo({ ...FILES, ...extra });
}

const read = (root: string, f: string) => readFileSync(join(root, f), "utf8");

describe("stripAnswers", () => {
    it("strips vuln-code-snippet markers and keeps the code they mark", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const text = read(root, "routes/login.ts");
        expect(text).not.toContain("vuln-code-snippet");
        expect(text).toContain("db.query(`SELECT * FROM Users WHERE email = '${req.body.email}'`)\n");
        expect(text).toContain("res.json({ ok: true");
    });

    it("keeps the code on hide lines and inside hide blocks, without their markers", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const text = read(root, "routes/login.ts");
        expect(text).toContain("  session.touch(req)\n");
        expect(text).not.toContain("hide-");
    });

    it("removes the answer statements whole: solveIf, verify calls and verify socket handlers", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const text = read(root, "routes/login.ts");
        expect(text).not.toContain("solveIf");
        expect(text).not.toContain("req.body.email === 'admin'");
        expect(text).not.toContain("verifyPreLoginChallenges");
        expect(text).not.toContain("jwtChallenges");
        expect(text).not.toContain("log(data)");
    });

    it("removes a challengeUtils.notSolved block through its closing brace", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const text = read(root, "routes/login.ts");
        expect(text).not.toContain("notSolved");
        expect(text).not.toContain("req.query.board");
        expect(text).toMatch(/session\.touch\(req\)\n  res\.json/);
    });

    it("removes the imports of a deleted module and lists them", async () => {
        const root = await tree();
        const { removedImports } = await stripAnswers(root, RULES);
        expect(read(root, "routes/login.ts")).not.toContain("import * as verify");
        expect(read(root, "routes/login.ts")).toContain("import { challenges } from '../data'");
        expect(removedImports).toEqual(["routes/login.ts: ./verify"]);
    });

    it("deletes the answer folders, files and patterns", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        expect(existsSync(join(root, "data/static/codefixes"))).toBe(false);
        expect(existsSync(join(root, "data/static/challenges.yml"))).toBe(false);
        expect(existsSync(join(root, "test"))).toBe(false);
        expect(existsSync(join(root, "frontend/src/app/login.component.spec.ts"))).toBe(false);
        expect(existsSync(join(root, "frontend/src/app/login.component.ts"))).toBe(true);
        expect(existsSync(join(root, "README.md"))).toBe(true);
    });

    it("maps an original line to its prepared line, and a removed line to null", async () => {
        const root = await tree();
        const { lineMap } = await stripAnswers(root, RULES);
        const login = lineMap.get("routes/login.ts")!;
        expect(login(1)).toBe(1);
        expect(login(2)).toBeNull();
        expect(login(3)).toBeNull();
        expect(login(4)).toBe(2);
        expect(login(5)).toBeNull();
        expect(login(6)).toBe(3);
        expect(login(11)).toBe(4);
        expect(lineMap.get("test/login.spec.ts")!(1)).toBeNull();
    });

    it("renames every answer key to one opaque token, in both cases, and leaves none", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const token = read(root, "routes/login.ts").match(/isChallengeEnabled\(challenges\.(\w+)\)/)![1];
        expect(token).toMatch(/^ch[0-9a-f]{8}$/);
        const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
            .split("\n")
            .filter(f => f && existsSync(join(root, f)));
        expect(files.map(f => read(root, f)).join("\n")).not.toMatch(/loginAdminChallenge|scoreBoardChallenge/i);
        const again = await tree({ "lib/x.ts": "on('verifyScoreBoardChallenge', challenges.scoreBoardChallenge)\n" });
        await stripAnswers(again, RULES);
        expect(read(again, "lib/x.ts")).toBe(`on('verify${token[0].toUpperCase()}${token.slice(1)}', challenges.${token})\n`);
    });

    it("refuses a tree where a key survives in another form, naming the file and line", async () => {
        const root = await tree({ "docs/HINTS.md": "Intro\nSolve SCOREBOARDCHALLENGE first.\n" });
        await expect(stripAnswers(root, RULES)).rejects.toThrow(/docs\/HINTS\.md:2/);
    });

    it("refuses a change that breaks a file's syntax", async () => {
        const root = await tree({ "lib/broken.ts": "if (ready) { challengeUtils.solveIf(c, () => true)\n  go()\n}\n" });
        await expect(stripAnswers(root, RULES)).rejects.toThrow(/lib\/broken\.ts/);
    });

    it("strips a marker from a CRLF line and keeps the line ending", async () => {
        const root = await tree({ "lib/crlf.ts": "run(x) // vuln-code-snippet vuln-line loginAdminChallenge\r\nnext()\r\n" });
        await stripAnswers(root, RULES);
        expect(read(root, "lib/crlf.ts")).toBe("run(x)\r\nnext()\r\n");
    });

    it("leaves a symlinked file and what it points at alone", async () => {
        const outside = await mkdtemp(join(tmpdir(), "outside-"));
        writeFileSync(join(outside, "a.ts"), "x() // vuln-code-snippet vuln-line loginAdminChallenge\n");
        const root = await tree();
        symlinkSync(join(outside, "a.ts"), join(root, "link.ts"));
        execFileSync("git", ["add", "link.ts"], { cwd: root });
        await stripAnswers(root, RULES);
        expect(readFileSync(join(outside, "a.ts"), "utf8")).toContain("vuln-code-snippet");
    });

    it("produces the same prepared tree when run twice", async () => {
        const trees: string[] = [];
        for (let i = 0; i < 2; i++) {
            const root = await tree();
            await stripAnswers(root, RULES);
            await commitPrepared(root);
            trees.push(execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim());
        }
        expect(trees[1]).toBe(trees[0]);
    });
});

describe("commitPrepared", () => {
    it("commits with a fixed author and date, so one parent and one tree give one SHA", async () => {
        const root = await mkdtemp(join(tmpdir(), "prep-"));
        execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base"], {
            cwd: root,
            env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" }
        });
        const a = await commitPrepared(root);
        execFileSync("git", ["reset", "-q", "--hard", "HEAD~1"], { cwd: root });
        expect(await commitPrepared(root)).toBe(a);
    });
});

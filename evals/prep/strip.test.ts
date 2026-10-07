import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { type StripRules, commitPrepared, stripAnswers } from "./strip";

const LOGIN = [
    "import { challenges } from '../data'",
    "// vuln-code-snippet start loginAdminChallenge",
    "export function login (req, res) {",
    "  verifyPreLoginChallenges(req) // vuln-code-snippet hide-line",
    "  db.query(`SELECT * FROM Users WHERE email = '${req.body.email}'`) // vuln-code-snippet vuln-line loginAdminChallenge",
    "  challengeUtils.solveIf(challenges.loginAdminChallenge, () => {",
    "    return req.body.email === 'admin'",
    "  })",
    "  // vuln-code-snippet hide-start",
    "  antiCheat(challenges.loginAdminChallenge)",
    "  // vuln-code-snippet hide-end",
    "  res.json({ ok: true })",
    "}",
    "// vuln-code-snippet end loginAdminChallenge",
    ""
].join("\n");

const KEYS = ["export const CHALLENGE_KEYS = [", "  'loginAdminChallenge',", "  'scoreBoardChallenge'", "]", ""].join("\n");

const RULES: StripRules = {
    deletePaths: ["data/static/codefixes/", "test/", "data/static/challenges.yml"],
    statementPatterns: [/\bchallengeUtils\.solveIf\(/],
    keyLine: /^\s*['"`]\w+Challenge['"`],?\s*$/
};

async function tree() {
    return makeRepo({
        "routes/login.ts": LOGIN,
        "models/challenge.ts": KEYS,
        "data/static/codefixes/loginAdminChallenge_1_correct.ts": "fixed\n",
        "data/static/challenges.yml": "- key: loginAdminChallenge\n",
        "test/login.spec.ts": "it('solves loginAdminChallenge')\n",
        "README.md": "A shop.\n"
    });
}

describe("stripAnswers", () => {
    it("strips vuln-code-snippet markers and keeps the code they mark", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const text = readFileSync(join(root, "routes/login.ts"), "utf8");
        expect(text).not.toContain("vuln-code-snippet");
        expect(text).toContain("db.query(`SELECT * FROM Users WHERE email = '${req.body.email}'`)\n");
        expect(text).toContain("res.json({ ok: true })");
    });

    it("removes hide-line lines and hide-start to hide-end blocks", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const text = readFileSync(join(root, "routes/login.ts"), "utf8");
        expect(text).not.toContain("verifyPreLoginChallenges");
        expect(text).not.toContain("antiCheat");
    });

    it("removes a multi-line challengeUtils.solveIf statement whole", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const text = readFileSync(join(root, "routes/login.ts"), "utf8");
        expect(text).not.toContain("solveIf");
        expect(text).not.toContain("req.body.email === 'admin'");
    });

    it("deletes the answer folders and files", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        expect(existsSync(join(root, "data/static/codefixes"))).toBe(false);
        expect(existsSync(join(root, "data/static/challenges.yml"))).toBe(false);
        expect(existsSync(join(root, "test"))).toBe(false);
        expect(existsSync(join(root, "README.md"))).toBe(true);
    });

    it("maps an original line to its prepared line, and a removed line to null", async () => {
        const root = await tree();
        const map = await stripAnswers(root, RULES);
        const login = map.get("routes/login.ts")!;
        expect(login(1)).toBe(1);
        expect(login(2)).toBeNull();
        expect(login(3)).toBe(2);
        expect(login(4)).toBeNull();
        expect(login(5)).toBe(3);
        expect(login(12)).toBe(4);
        expect(map.get("test/login.spec.ts")!(1)).toBeNull();
    });

    it("leaves no challenge key anywhere in the prepared tree", async () => {
        const root = await tree();
        await stripAnswers(root, RULES);
        const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" })
            .split("\n")
            .filter(f => f && existsSync(join(root, f)));
        const all = files.map(f => readFileSync(join(root, f), "utf8")).join("\n");
        expect(all).not.toMatch(/loginAdminChallenge|scoreBoardChallenge/);
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

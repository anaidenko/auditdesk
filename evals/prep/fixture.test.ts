import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { prepareFixture } from "./fixture";

const rules = { deletePaths: ["answers/"], statementPatterns: [/\bsolveIf\(/] };

describe("prepareFixture", () => {
    it("snapshots the pinned commit, removes the answers, and gives the same prepared SHA every time", async () => {
        const source = await makeRepo({
            "app.ts":
                "const a = 1 // vuln-code-snippet vuln-line demoChallenge\nsolveIf(challenges.demoChallenge, () => true)\nexport {}\n",
            "answers/demo.md": "the answer\n"
        });
        const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        const first = await prepareFixture({ name: "demo", url: source, sha, rules }, ws);
        expect(first.upstreamSha).toBe(sha);
        expect(readFileSync(join(first.path, "app.ts"), "utf8")).toBe("const a = 1\nexport {}\n");
        expect(existsSync(join(first.path, "answers"))).toBe(false);
        expect(first.lineMap.get("app.ts")!(3)).toBe(2);
        const again = await prepareFixture({ name: "demo", url: source, sha, rules }, ws);
        expect(again.preparedSha).toBe(first.preparedSha);
        expect(execFileSync("git", ["status", "--porcelain"], { cwd: again.path, encoding: "utf8" })).toBe("");
    });

    it("refuses a commit the source does not have", async () => {
        const source = await makeRepo({ "a.ts": "x\n" });
        await expect(
            prepareFixture({ name: "demo", url: source, sha: "0".repeat(40), rules }, await mkdtemp(join(tmpdir(), "ws-")))
        ).rejects.toThrow(/0000000000000000000000000000000000000000/);
    });
});

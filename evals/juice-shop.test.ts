import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { keyProblems, loadFixtures, loadKey } from "./fixtures";

const spec = loadFixtures().find(f => f.name === "juice-shop")!;
const key = loadKey("juice-shop");
const tree = join(homedir(), ".auditdesk/workspace/evals", `juice-shop-${spec.sha.slice(0, 12)}`);
const head = existsSync(tree) ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim() : null;

// The prepared tree exists only where `pnpm eval:key` ran; CI has none and skips.
describe.skipIf(head !== key.preparedSha)("the prepared Juice Shop tree", () => {
    it("holds every anchor of its key", () => {
        expect(keyProblems(key, tree, head!)).toEqual([]);
    });

    it("names no mapped challenge anywhere, in any case", () => {
        const map = parse(readFileSync("evals/answers/juice-shop-challenges.yaml", "utf8")) as { challenges: Record<string, unknown> };
        const names = Object.keys(map.challenges);
        const grep = spawnSync("git", ["grep", "-n", "-i", "-F", ...names.flatMap(n => ["-e", n]), "HEAD"], {
            cwd: tree,
            encoding: "utf8"
        });
        expect(grep.stdout).toBe("");
    });

    it("keeps the code the snippet view hid: the user model's attributes and the feedback CAPTCHA", () => {
        expect(readFileSync(join(tree, "models/user.ts"), "utf8")).toContain("sanitizeSecure");
        expect(readFileSync(join(tree, "server.ts"), "utf8")).toContain("app.post('/api/Feedbacks', utils.asyncHandler(verifyCaptcha()))");
    });
});

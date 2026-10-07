import type { StripRules } from "./strip";

/**
 * What OWASP Juice Shop v20.2.0 holds besides its code, read on 2026-10-07 (plan, Task 2.1, and the
 * code review of the eval): the coding challenges' fixes, their list, the tests and frontend specs,
 * the hacking instructor's tutorials, the translated challenge descriptions, the agent skills that
 * quote the markers, a snippet cache, the CTF config, the solve checks, the anti-cheat table and
 * the snippet machinery. In the code, the statements and blocks that score a challenge go; every
 * challenge key is renamed; the hide markers go but the code they hide stays.
 */
export const JUICE_SHOP_RULES: StripRules = {
    deletePaths: [
        "data/static/codefixes/",
        "data/static/challenges.yml",
        "data/static/i18n/",
        "test/",
        "frontend/**/*.spec.ts",
        "frontend/src/hacking-instructor/challenges/",
        ".ai/",
        "rsn/",
        "SOLUTIONS.md",
        "config/fbctf.yml",
        "routes/verify.ts",
        "lib/antiCheat.ts",
        "lib/codingChallenges.ts"
    ],
    statementPatterns: [
        /\bchallengeUtils\.solveIf\(/,
        /\bchallengeUtils\.solve\(/,
        /\bverify\w*Challenges\(/,
        /(?<![\w.])verify\.\w+\(/,
        /\bsocket\.on\(\s*['"]verify\w*['"]/,
        /\.emit\(\s*['"]verify\w*['"]/
    ],
    blockPatterns: [/^\s*if \(challengeUtils\.notSolved\(/],
    keyLine: /^\s*['"`]\w+Challenge['"`],?\s*$/,
    keys: { file: "data/static/challenges.yml", pattern: /^\s*key:\s*(\w+)\s*$/gm }
};

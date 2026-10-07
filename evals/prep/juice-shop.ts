import type { StripRules } from "./strip";

/**
 * What OWASP Juice Shop v20.2.0 holds besides its code, read on 2026-10-07 (plan, Task 2.1): the
 * coding challenges' fixes, their list, the tests, the agent skills that quote the markers, a
 * snippet cache, the CTF config, the solve checks, the anti-cheat table, the snippet machinery.
 */
export const JUICE_SHOP_RULES: StripRules = {
    deletePaths: [
        "data/static/codefixes/",
        "data/static/challenges.yml",
        "test/",
        ".ai/",
        "rsn/",
        "config/fbctf.yml",
        "routes/verify.ts",
        "lib/antiCheat.ts",
        "lib/codingChallenges.ts"
    ],
    statementPatterns: [/\bchallengeUtils\.solveIf\(/, /\bchallengeUtils\.solve\(/, /\bverify\w*Challenges\(/],
    keyLine: /^\s*['"`]\w+Challenge['"`],?\s*$/
};

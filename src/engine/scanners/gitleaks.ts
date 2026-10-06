import { createHash } from "node:crypto";

import { fingerprint } from "../findings";
import type { Masker } from "../masker";
import type { NewFinding } from "../types";

import type { GitleaksLeak } from "./types";

/**
 * The app's own config. Without --config, gitleaks reads the scanned repository's .gitleaks.toml,
 * and its .gitleaksignore and gitleaks:allow comments apply too: a client's allowlist would turn
 * masking off for exactly the secrets it lists, and no finding would say so.
 */
export const GITLEAKS_CONFIG = `# Written by Auditdesk for each run: gitleaks' default rules, nothing allowlisted.
[extend]
useDefault = true
`;

export function gitleaksArgs(): string[] {
    return [
        "git",
        "/repo",
        "--config",
        "/cfg/gitleaks.toml",
        // A folder with no .gitleaksignore in it: the client's ignore file is not read.
        "--gitleaks-ignore-path",
        "/cfg",
        "--ignore-gitleaks-allow",
        "--log-opts=--all",
        "--report-format",
        "json",
        "--report-path",
        "-",
        "--exit-code",
        "0",
        "--no-banner",
        "--log-level",
        "error"
    ];
}

export function parseGitleaks(stdout: string): GitleaksLeak[] {
    const start = stdout.indexOf("[");
    return start === -1 ? [] : JSON.parse(stdout.slice(start));
}

export function normaliseGitleaks(
    leaks: GitleaksLeak[],
    o: { repositoryId: string; masker: Masker; inTree: (leak: GitleaksLeak) => boolean }
): NewFinding[] {
    return leaks.map(leak => {
        const current = o.inTree(leak);
        const evidence = [{ file: leak.File, startLine: leak.StartLine, endLine: leak.EndLine, snippet: o.masker.mask(leak.Match) }];
        const base = { repositoryId: o.repositoryId, aspect: "security", checklistItem: "SEC-10", evidence };
        return {
            ...base,
            agentRunId: null,
            kind: "finding",
            title: current ? `Secret in the code: ${leak.Description}` : `Secret in git history: ${leak.Description}`,
            severity: current ? "critical" : "high",
            likelihood: current
                ? "Anyone with read access to the repository can use it."
                : "Anyone who clones the repository can recover it from history.",
            impact: "Depends on what the credential grants; assume full access to that service.",
            summary: current
                ? `A credential matching gitleaks rule "${leak.RuleID}" is committed in ${leak.File}.`
                : `A credential matching gitleaks rule "${leak.RuleID}" was committed in ${leak.File} (commit ${leak.Commit.slice(0, 8)}, ${leak.Date.slice(0, 10)}) and is still in the history.`,
            explanation: "Removing a secret from the code does not remove it from git history; every clone keeps it.",
            recommendation: "Rotate the credential first, then remove it from the code and load it from the environment or a secret store.",
            effort: "S",
            references: { cwe: "CWE-798" },
            tags: [],
            source: "scanner",
            // A hash of the secret, never the secret: three keys in one .env are three findings to rotate.
            fingerprint: fingerprint({ ...base, evidence: [{ ...evidence[0], snippet: `${leak.RuleID}:${secretHash(leak.Secret)}` }] })
        } satisfies NewFinding;
    });
}

function secretHash(secret: string): string {
    return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

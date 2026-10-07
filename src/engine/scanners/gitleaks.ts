import { createHash } from "node:crypto";

import { fingerprint } from "../findings";
import type { Masker } from "../masker";
import type { NewFinding } from "../types";

import { ROLE_WORDS, sampleRole } from "./paths";
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

/** gitleaks rules that fire on any long random string: in a sample file, mostly fake keys. */
const NOISY_RULES = new Set(["generic-api-key", "jwt"]);

export function normaliseGitleaks(
    leaks: GitleaksLeak[],
    o: { repositoryId: string; masker: Masker; inTree: (leak: GitleaksLeak) => boolean }
): NewFinding[] {
    return leaks.map(leak => {
        const current = o.inTree(leak);
        // A generic key in a test or seed file is often a fake one; it is still filed, rated lower. A
        // provider's own key format keeps its rating wherever it is.
        const role = sampleRole(leak.File);
        const lowered = role !== null && NOISY_RULES.has(leak.RuleID);
        const evidence = [{ file: leak.File, startLine: leak.StartLine, endLine: leak.EndLine, snippet: o.masker.mask(leak.Match) }];
        const base = { repositoryId: o.repositoryId, aspect: "security", checklistItem: "SEC-10", evidence };
        return {
            ...base,
            agentRunId: null,
            kind: "finding",
            title: `${current ? "Secret in the code" : "Secret in git history"}: ${role ? `${leak.Description.replace(/\.\s*$/, "")} (${ROLE_WORDS[role]})` : leak.Description}`,
            severity: lowered ? (current ? "medium" : "low") : current ? "critical" : "high",
            likelihood: role
                ? `It is ${ROLE_WORDS[role]}; whether the credential is real decides the risk.${
                      role === "seed" ? " Still, a seed that runs in production makes it a default credential on every deployment." : ""
                  }`
                : current
                  ? "Anyone with read access to the repository can use it."
                  : "Anyone who clones the repository can recover it from history.",
            impact: "Depends on what the credential grants; assume full access to that service.",
            summary: current
                ? `A credential matching gitleaks rule "${leak.RuleID}" is committed in ${leak.File}.`
                : `A credential matching gitleaks rule "${leak.RuleID}" was committed in ${leak.File} (commit ${leak.Commit.slice(0, 8)}, ${leak.Date.slice(0, 10)}) and is still in the history.`,
            explanation: "Removing a secret from the code does not remove it from git history; every clone keeps it.",
            recommendation: role
                ? current
                    ? "Check whether the credential is real. If it is, rotate it and replace it with a fake one."
                    : "Rotate it if it is real."
                : "Rotate the credential first, then remove it from the code and load it from the environment or a secret store.",
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

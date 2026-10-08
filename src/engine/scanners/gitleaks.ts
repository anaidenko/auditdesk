import { createHash } from "node:crypto";

import { fingerprint } from "../findings";
import type { Masker } from "../masker";
import type { NewFinding } from "../types";

import { type Place, comparePlaces, effortFor, filesPhrase, groupFingerprint, groupPlaces } from "./group";
import { ROLE_WORDS, type SampleRole, sampleRole } from "./paths";
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

const ACRONYMS: Record<string, string> = {
    api: "API",
    id: "ID",
    pat: "PAT",
    jwt: "JWT",
    url: "URL",
    aws: "AWS",
    gcp: "GCP",
    ca: "CA",
    tf: "TF",
    cicd: "CI/CD",
    scim: "SCIM",
    ptt: "PTT",
    rrt: "RRT",
    ad: "AD",
    yaml: "YAML",
    pkcs12: "PKCS#12",
    oauth: "OAuth",
    nuget: "NuGet",
    kubernetes: "Kubernetes"
};
// Rule IDs whose words read badly: a typo, an opaque abbreviation, a format detail.
const KINDS: Record<string, string> = {
    "airtable-personnal-access-token": "Airtable personal access token",
    "aws-amazon-bedrock-api-key-long-lived": "Amazon Bedrock long-lived API key",
    "aws-amazon-bedrock-api-key-short-lived": "Amazon Bedrock short-lived API key",
    "github-oauth": "GitHub OAuth access token",
    "gitlab-pat-routable": "GitLab PAT",
    "gitlab-ptt": "GitLab pipeline trigger token",
    "gitlab-rrt": "GitLab runner registration token",
    "gitlab-runner-authentication-token-routable": "GitLab runner authentication token",
    "heroku-api-key-v2": "Heroku API key",
    "jwt-base64": "base64-encoded JWT",
    "kubernetes-secret-yaml": "Kubernetes secret",
    "octopus-deploy-api-key": "Octopus Deploy API key"
};
// Rule IDs that open with a kind of secret, not a provider.
const GENERIC = new Set(["generic", "private", "jwt", "curl", "age", "kubernetes", "pkcs12", "nuget", "npm"]);
// Words after a provider's name in a rule ID: the words before the first of them name the provider.
const COMMON = new Set(
    "access token key secret client api id user app service account refresh password webhook url private public pub signing encryption license deploy session cookie config legacy bot bearer personal personnal upload admin global origin delivery organization identity reference runner authentication feed incoming mail agent job feature flag test page shared custom batch insert browser application workspace auth header file yaml pat oauth ptt rrt scim cicd sensitive long short fine grained routable lived base64 v2 org".split(
        " "
    )
);

/**
 * The kind of secret a gitleaks rule finds, from its ID: "generic API key", "GitHub PAT", "New
 * Relic user API key". A provider's name is spelled as the rule's description spells it.
 */
export function secretKind(rule: string, description: string): string {
    if (KINDS[rule]) return KINDS[rule];
    const words = description.split(/[^A-Za-z0-9#/]+/);
    const parts = rule.split("-");
    const common = parts.findIndex(w => COMMON.has(w));
    const provider = GENERIC.has(parts[0]) ? 0 : Math.max(1, common === -1 ? parts.length : common);
    return parts
        .map((w, i) => {
            if (ACRONYMS[w]) return ACRONYMS[w];
            if (i >= provider) return w;
            const spelled = words.filter(x => x.toLowerCase() === w).find(x => /[A-Z]/.test(x));
            return spelled ?? w[0].toUpperCase() + w.slice(1);
        })
        .join(" ");
}

const PLURAL = /(key|token|secret|ID|password|webhook|cookie|header|file|PAT|URL|JWT)$/;
/** "7 generic API keys"; a kind with no plural here reads "2 curl auth user secrets". */
const counted = (n: number, kind: string) => (PLURAL.test(kind) ? `${n} ${kind}s` : `${n} ${kind} secrets`);

type Leak = { leak: GitleaksLeak; current: boolean; role: SampleRole | null; place: Place };

/** `known`: places filed before, left out, so a group files only what is new. */
export function normaliseGitleaks(
    leaks: GitleaksLeak[],
    o: { repositoryId: string; masker: Masker; inTree: (leak: GitleaksLeak) => boolean; known?: Set<string> }
): NewFinding[] {
    const located = leaks.map((leak): Leak => {
        const evidence = { file: leak.File, startLine: leak.StartLine, endLine: leak.EndLine, snippet: o.masker.mask(leak.Match) };
        // A hash of the secret, never the secret: three keys in one .env are three places to rotate.
        const key = fingerprint({
            repositoryId: o.repositoryId,
            aspect: "security",
            checklistItem: "SEC-10",
            evidence: [{ ...evidence, snippet: `${leak.RuleID}:${secretHash(leak.Secret)}` }]
        });
        const current = o.inTree(leak);
        // After the key, so the commit never changes a place's fingerprint.
        return { leak, current, role: sampleRole(leak.File), place: { ...evidence, key, ...(current ? {} : { commit: leak.Commit }) } };
    });
    // Rule, code or history, and sample role set a finding's severity and words: one finding per each.
    return groupPlaces(located, l => `${l.leak.RuleID}\n${l.current}\n${l.role}`, o.known).map(g => leakFinding(g, o.repositoryId));
}

function leakFinding(group: Leak[], repositoryId: string): NewFinding {
    const sorted = [...group].sort((a, b) => comparePlaces(a.place, b.place));
    const places = sorted.map(l => l.place);
    const { leak, current, role } = sorted[0];
    const n = group.length;
    const one = n === 1;
    const kind = secretKind(leak.RuleID, leak.Description);
    // A generic key in a test or seed file is often a fake one; it is still filed, rated lower. A
    // provider's own key format keeps its rating wherever it is.
    const lowered = role !== null && NOISY_RULES.has(leak.RuleID);
    const where = current ? "in the code" : "in git history";
    const fileCount = new Set(places.map(p => p.file)).size;
    const inFiles = fileCount === 1 ? leak.File : `${fileCount} files`;
    return {
        repositoryId,
        agentRunId: null,
        aspect: "security",
        kind: "finding",
        checklistItem: "SEC-10",
        title: one
            ? `Secret ${where}: ${kind}${role ? ` (${ROLE_WORDS[role]})` : ""}`
            : `Secrets ${where}: ${counted(n, kind)} in ${filesPhrase(places, role)}`,
        severity: lowered ? (current ? "medium" : "low") : current ? "critical" : "high",
        likelihood: role
            ? `${one ? `It is ${ROLE_WORDS[role]}` : `They are in ${filesPhrase(places, role)}`}; whether the ${one ? "credential is" : "credentials are"} real decides the risk.${
                  role === "seed"
                      ? ` Still, a seed that runs in production makes ${one ? "it a default credential" : "them default credentials"} on every deployment.`
                      : ""
              }`
            : current
              ? `Anyone with read access to the repository can use ${one ? "it" : "them"}.`
              : `Anyone who clones the repository can recover ${one ? "it" : "them"} from history.`,
        impact: one
            ? "Depends on what the credential grants; assume full access to that service."
            : "Depends on what the credentials grant; assume full access to those services.",
        summary: one
            ? current
                ? `A credential matching gitleaks rule "${leak.RuleID}" is committed in ${leak.File}.`
                : `A credential matching gitleaks rule "${leak.RuleID}" was committed in ${leak.File} (commit ${leak.Commit.slice(0, 8)}, ${leak.Date.slice(0, 10)}) and is still in the history.`
            : current
              ? `${n} credentials matching gitleaks rule "${leak.RuleID}" are committed in ${inFiles}.`
              : `${n} credentials matching gitleaks rule "${leak.RuleID}" were committed in ${inFiles} and are still in the history.`,
        explanation: [
            `gitleaks: ${leak.Description.replace(/\.?\s*$/, ".")}`,
            "Removing a secret from the code does not remove it from git history; every clone keeps it.",
            !current && !one
                ? `Commits: ${sorted.map(l => `${l.leak.File} at ${l.leak.Commit.slice(0, 8)} (${l.leak.Date.slice(0, 10)})`).join("; ")}.`
                : ""
        ]
            .filter(Boolean)
            .join(" "),
        recommendation: role
            ? current
                ? one
                    ? "Check whether the credential is real. If it is, rotate it and replace it with a fake one."
                    : "Check whether each credential is real. Rotate any that is, and replace it with a fake one."
                : one
                  ? "Rotate it if it is real."
                  : "Rotate any that is real."
            : one
              ? "Rotate the credential first, then remove it from the code and load it from the environment or a secret store."
              : "Rotate the credentials first, then remove them from the code and load them from the environment or a secret store.",
        effort: effortFor(places),
        effortHours: null,
        references: { cwe: "CWE-798" },
        tags: [],
        source: "scanner",
        fingerprint: groupFingerprint(places),
        evidence: places
    } satisfies NewFinding;
}

function secretHash(secret: string): string {
    return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

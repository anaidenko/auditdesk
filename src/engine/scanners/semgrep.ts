import { fingerprint } from "../findings";
import type { Masker } from "../masker";
import type { NewFinding, SeverityName } from "../types";

import { ROLE_WORDS, sampleRole } from "./paths";
import type { Ruleset, SemgrepResult } from "./types";

export function semgrepArgs(rulesets: Ruleset[]): string[] {
    const configs = rulesets.flatMap(r => ["--config", `/rules/${r.name}.yml`]);
    // The client's nosem comments and .semgrepignore would hide results from their own auditor.
    return [
        "semgrep",
        "scan",
        ...configs,
        "--disable-nosem",
        "--x-ignore-semgrepignore-files",
        "--json",
        "--metrics",
        "off",
        "--disable-version-check",
        "--quiet",
        "/src"
    ];
}

export function parseSemgrep(stdout: string): SemgrepResult[] {
    return (JSON.parse(stdout).results ?? []).map((r: SemgrepResult) => ({ ...r, path: r.path.replace(/^\/src\//, "") }));
}

const BY_CWE: [RegExp, string][] = [
    [/^CWE-(89|78|77|94|95|943|1336)$/, "SEC-04"],
    [/^CWE-79$/, "SEC-05"],
    [/^CWE-(352|942)$/, "SEC-06"],
    [/^CWE-918$/, "SEC-07"],
    [/^CWE-(22|434|73)$/, "SEC-08"],
    [/^CWE-(20|915)$/, "SEC-09"],
    [/^CWE-(798|321|522)$/, "SEC-10"],
    [/^CWE-(693|319|614|1004)$/, "SEC-11"],
    [/^CWE-(532|209|200)$/, "SEC-13"],
    [/^CWE-(327|328|330|338|916)$/, "SEC-14"],
    [/^CWE-(287|306|307|521)$/, "SEC-01"],
    [/^CWE-(345|347|384|613)$/, "SEC-02"],
    [/^CWE-(284|285|639|862|863)$/, "SEC-03"]
];

function firstCwe(meta: SemgrepResult["extra"]["metadata"]): string | undefined {
    const raw = Array.isArray(meta.cwe) ? meta.cwe[0] : meta.cwe;
    return raw?.match(/CWE-\d+/)?.[0];
}

const SEVERITY: Record<string, SeverityName> = { ERROR: "high", WARNING: "medium", INFO: "low" };

export function normaliseSemgrep(results: SemgrepResult[], o: { repositoryId: string; masker: Masker }): NewFinding[] {
    return results.map(r => {
        const cwe = firstCwe(r.extra.metadata);
        const item = BY_CWE.find(([re]) => cwe && re.test(cwe))?.[1] ?? "SEC-15";
        const evidence = [{ file: r.path, startLine: r.start.line, endLine: r.end.line, snippet: o.masker.mask(r.extra.lines) }];
        const base = { repositoryId: o.repositoryId, aspect: "security", checklistItem: item, evidence };
        const role = sampleRole(r.path);
        return {
            ...base,
            agentRunId: null,
            kind: "finding",
            title: `${o.masker.mask(r.extra.message.split(/(?<=\.)\s/)[0].slice(0, 160)).replace(role ? /\.\s*$/ : /$^/, "")}${role ? ` (${ROLE_WORDS[role]})` : ""}`,
            // In a sample file a hard-coded secret is rated as gitleaks rates it; anything else is low.
            severity: role ? (item === "SEC-10" ? "medium" : "low") : (SEVERITY[r.extra.severity] ?? "medium"),
            likelihood: null,
            impact: null,
            summary: o.masker.mask(r.extra.message),
            explanation: `Semgrep rule ${r.check_id}.`,
            recommendation: "Confirm the input is attacker-controlled; if so, follow the rule's references.",
            effort: "S",
            references: { cwe, cheatSheets: r.extra.metadata.references?.filter(u => u.includes("cheatsheetseries.owasp.org")) },
            tags: [],
            source: "scanner",
            fingerprint: fingerprint({ ...base, evidence: [{ ...evidence[0], snippet: `${r.check_id}\n${evidence[0].snippet}` }] })
        } satisfies NewFinding;
    });
}

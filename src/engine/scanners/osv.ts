import { fingerprint } from "../findings";
import type { NewFinding, SeverityName } from "../types";

import type { OsvPackage } from "./types";

/** Overrides the client's osv-scanner.toml, whose ignore lists would hide known vulnerabilities. */
export const OSV_CONFIG = "# Written by Auditdesk for each run: no vulnerability is ignored.\n";

export function osvArgs(): string[] {
    return ["scan", "source", "--recursive", "--config", "/cfg/osv-scanner.toml", "--format", "json", "/src"];
}

interface OsvJson {
    results?: {
        source: { path: string };
        packages: {
            package: { name: string; version: string; ecosystem: string };
            vulnerabilities?: { id: string; aliases?: string[]; summary?: string }[];
            groups?: { max_severity?: string }[];
        }[];
    }[];
}

export function parseOsv(stdout: string): OsvPackage[] {
    if (!stdout.trim()) return [];
    const json = JSON.parse(stdout) as OsvJson;
    return (json.results ?? []).flatMap(r =>
        r.packages.map(p => {
            const scores = (p.groups ?? []).map(g => Number(g.max_severity)).filter(n => Number.isFinite(n) && n > 0);
            return {
                source: r.source.path.replace(/^\/src\//, ""),
                name: p.package.name,
                version: p.package.version,
                ecosystem: p.package.ecosystem,
                vulnerabilities: (p.vulnerabilities ?? []).map(v => ({ id: v.id, aliases: v.aliases ?? [], summary: v.summary ?? "" })),
                maxSeverity: scores.length ? Math.max(...scores) : null
            };
        })
    );
}

function severityFromCvss(score: number | null): SeverityName {
    if (score === null) return "medium";
    return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";
}

export function normaliseOsv(pkgs: OsvPackage[], o: { repositoryId: string }): NewFinding[] {
    return pkgs
        .filter(p => p.vulnerabilities.length)
        .map(p => {
            const ids = p.vulnerabilities.map(v => v.id);
            const evidence = [{ file: p.source, startLine: 1, endLine: 1, snippet: `${p.name}@${p.version}` }];
            const base = { repositoryId: o.repositoryId, aspect: "dependencies", checklistItem: "DEP-01", evidence };
            return {
                ...base,
                agentRunId: null,
                kind: "finding",
                title: `${p.name} ${p.version}: ${ids.length} known ${ids.length === 1 ? "vulnerability" : "vulnerabilities"}`,
                severity: severityFromCvss(p.maxSeverity),
                likelihood: null,
                impact: p.vulnerabilities[0].summary || null,
                summary: `${p.name} ${p.version} (${p.ecosystem}) has published advisories: ${ids.join(", ")}.`,
                explanation: p.vulnerabilities.map(v => `${v.id}: ${v.summary}`).join("\n"),
                recommendation: `Upgrade ${p.name} to a release that fixes these advisories, then re-run the tests.`,
                effort: "S",
                references: { advisories: ids },
                tags: [],
                source: "scanner",
                fingerprint: fingerprint(base)
            } satisfies NewFinding;
        });
}

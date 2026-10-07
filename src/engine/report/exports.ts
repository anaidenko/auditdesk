import type { Ref } from "../references";
import type { SeverityName } from "../types";

import type { ReportData, ReportFinding } from "./types";

/** SARIF's three result levels; an audit's critical and high are errors, a low or info a note. */
const LEVEL: Record<SeverityName, "error" | "warning" | "note"> = {
    critical: "error",
    high: "error",
    medium: "warning",
    low: "note",
    info: "note"
};

export interface SarifLog {
    $schema: string;
    version: "2.1.0";
    runs: {
        tool: {
            driver: { name: string; informationUri: string; rules: { id: string; name: string; shortDescription: { text: string } }[] };
        };
        results: {
            ruleId: string;
            level: "error" | "warning" | "note";
            message: { text: string };
            locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number; endLine: number } } }[];
            partialFingerprints: Record<string, string>;
            properties: { label: string; severity: SeverityName | null; aspect: string; cwe?: string };
        }[];
        properties: { repository: string; branch: string; commit: string };
    }[];
}

/**
 * The reported findings as SARIF 2.1.0, one run per repository, for code-scanning tools and CI:
 * the rule is the checklist item, the level follows the severity, and the finding's stable label
 * is its fingerprint. Questions have no location, so they stay in the report.
 */
export function sarif(d: ReportData): SarifLog {
    const titles = new Map(d.aspects.flatMap(a => a.coverage.map(c => [c.item, c.title] as const)));
    return {
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
        runs: d.repositories.map(repo => {
            const findings = d.findings.filter(f => f.repository === repo.name);
            const items = [...new Set(findings.map(f => f.checklistItem ?? "other"))];
            return {
                tool: {
                    driver: {
                        name: "Auditdesk",
                        informationUri: "https://github.com/anaidenko/auditdesk",
                        rules: items.map(id => ({ id, name: id, shortDescription: { text: titles.get(id) ?? id } }))
                    }
                },
                results: findings.map(f => ({
                    ruleId: f.checklistItem ?? "other",
                    level: LEVEL[f.severity ?? "info"],
                    message: { text: `${f.title}. ${f.summary}` },
                    locations: f.evidence.map(e => ({
                        physicalLocation: { artifactLocation: { uri: e.file }, region: { startLine: e.startLine, endLine: e.endLine } }
                    })),
                    partialFingerprints: { "auditdesk/finding": f.label },
                    properties: {
                        label: f.label,
                        severity: f.severity,
                        aspect: f.aspect,
                        ...(f.references.cwe ? { cwe: f.references.cwe } : {})
                    }
                })),
                properties: { repository: repo.name, branch: repo.branch, commit: repo.sha }
            };
        })
    };
}

export interface IssueDraft {
    title: string;
    body: string;
    labels: string[];
    severity: SeverityName | null;
}

const link = (r: Ref) => (r.url ? `[${r.label}](${r.url})` : r.label);

function body(f: ReportFinding): string {
    const refs = f.refs ? [f.refs.top10, f.refs.cwe, ...f.refs.asvs, ...f.refs.cheatsheets, ...f.refs.advisories, f.refs.nist] : [];
    const lines = [
        `**Severity:** ${f.severity ?? "question"} · **Checklist item:** ${f.checklistItem ?? "none"} · **Repository:** ${f.repository}${
            f.effort ? ` · **Effort:** ${f.effort}` : ""
        }`,
        "",
        f.summary,
        "",
        "### Details",
        "",
        f.explanation,
        ...(f.likelihood || f.impact
            ? ["", `**Likelihood:** ${f.likelihood ?? "not stated"}`, `**Impact:** ${f.impact ?? "not stated"}`]
            : []),
        "",
        "### Evidence",
        "",
        ...f.evidence.flatMap(e => [
            `\`${e.file}\`, ${e.startLine === e.endLine ? `line ${e.startLine}` : `lines ${e.startLine}–${e.endLine}`}`,
            ...(e.snippet ? ["", "```", e.snippet, "```"] : []),
            ""
        ]),
        "### Recommendation",
        "",
        f.recommendation,
        ...(refs.some(Boolean) ? ["", "### References", "", ...refs.filter((r): r is Ref => !!r).map(r => `- ${link(r)}`)] : []),
        "",
        `_From the Auditdesk report, finding ${f.label}._`
    ];
    return lines.join("\n");
}

/** One tracker issue per reported finding, for GitHub, Linear or any tracker that takes Markdown. */
export function issueDrafts(d: ReportData): IssueDraft[] {
    return d.findings.map(f => ({
        title: `${f.label}: ${f.title}`,
        body: body(f),
        labels: ["audit", f.severity ?? "question", f.aspect.toLowerCase().replace(/[^a-z0-9]+/g, "-")],
        severity: f.severity
    }));
}

const PRIORITY: Record<SeverityName, string> = { critical: "Urgent", high: "High", medium: "Medium", low: "Low", info: "No priority" };

/** The drafts as RFC 4180 CSV with every field quoted: Title, Description, Priority (Linear's names), Labels. */
export function issuesCsv(drafts: IssueDraft[]): string {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
        ["Title", "Description", "Priority", "Labels"].map(q).join(","),
        ...drafts.map(i => [i.title, i.body, PRIORITY[i.severity ?? "info"], i.labels.join(",")].map(q).join(","))
    ].join("\r\n");
}

/**
 * `gh issue create` per draft, the body on stdin so no shell quoting is involved. Labels are added
 * only when asked: `gh` fails on a label the repository does not have.
 */
export function ghIssueCommands(drafts: IssueDraft[], repo: string, o: { labels: boolean }): { args: string[]; stdin: string }[] {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`The repository must be owner/name, not "${repo}".`);
    return drafts.map(d => ({
        args: [
            "issue",
            "create",
            "--repo",
            repo,
            "--title",
            d.title,
            "--body-file",
            "-",
            ...(o.labels ? d.labels.flatMap(l => ["--label", l]) : [])
        ],
        stdin: d.body
    }));
}

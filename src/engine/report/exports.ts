import { SEAMS, aspectTitle } from "../aspects";
import { compareFindings } from "../findings";
import type { Ref } from "../references";
import type { Evidence, SeverityName } from "../types";

import type { ReportData, ReportFinding } from "./types";

/** SARIF's three result levels; an audit's critical and high are errors, a low or info a note. */
const LEVEL: Record<SeverityName, "error" | "warning" | "note"> = {
    critical: "error",
    high: "error",
    medium: "warning",
    low: "note",
    info: "note"
};

/**
 * GitHub treats a rule as a security rule only when it carries `security-severity`, read per rule,
 * not per result: over 9.0 is critical, 7.0 to 8.9 high, 4.0 to 6.9 medium, 0.1 to 3.9 low.
 */
const SECURITY_SEVERITY: Partial<Record<SeverityName, string>> = { critical: "9.5", high: "8.0", medium: "5.5", low: "2.0" };
const SECURITY_ITEM = /^(SEC|DEP|LLM|TEN)-/;
const RANK: SeverityName[] = ["info", "low", "medium", "high", "critical"];

type SarifRule = {
    id: string;
    name: string;
    shortDescription: { text: string };
    properties?: { "tags": string[]; "security-severity"?: string };
};

export interface SarifLog {
    $schema: string;
    version: "2.1.0";
    runs: {
        tool: { driver: { name: string; informationUri: string; rules: SarifRule[] } };
        results: {
            ruleId: string;
            level: "error" | "warning" | "note";
            message: { text: string };
            locations: {
                physicalLocation: {
                    artifactLocation: { uri: string; uriBaseId: "%SRCROOT%" };
                    region: { startLine: number; endLine: number };
                };
            }[];
            partialFingerprints: Record<string, string>;
            properties: { label: string; severity: SeverityName | null; aspect: string; cwe?: string };
        }[];
        properties: { repository: string; branch: string; commit: string };
    }[];
}

// GitHub reads only a result's first location, so each place of a scanner finding of several gets a result.
const byPlace = (f: ReportFinding): { f: ReportFinding; place: Evidence | null }[] =>
    f.evidence.length > 1 && f.evidence.every(e => e.key) ? f.evidence.map(place => ({ f, place })) : [{ f, place: null }];
const number = (f: ReportFinding) => Number(f.label.replace(/\D/g, ""));
const bySeverity = (fs: ReportFinding[]) =>
    [...fs].sort((a, b) => compareFindings({ ...a, number: number(a) }, { ...b, number: number(b) }));

/**
 * One repository's reported findings as SARIF 2.1.0, for code scanning and CI: an upload goes to
 * one repository, and GitHub rejects a file with two runs of one tool. The rule is the checklist
 * item and the level follows the severity. The label rides along as a fingerprint for other tools;
 * GitHub computes its own from the checked-out source. Questions have no location, so they stay in
 * the report.
 */
export function sarif(d: ReportData, repository: string): SarifLog {
    const repo = d.repositories.find(r => r.name === repository);
    if (!repo) throw new Error(`No repository "${repository}" in this report.`);
    const titles = new Map([
        ...Object.entries(d.itemTitles ?? {}),
        ...d.aspects.flatMap(a => a.coverage.filter(c => c.title).map(c => [c.item, c.title] as const))
    ]);
    // A seams finding cites several repositories: each one's upload gets it with its own locations.
    const seamsPrefix = d.seamsPaths?.find(p => p.repository === repo.name)?.path;
    const own = (f: ReportFinding): ReportFinding | null => {
        if (f.repository === repo.name) return f;
        if (!seamsPrefix || f.aspect !== aspectTitle(SEAMS)) return null;
        const evidence = f.evidence
            .filter(e => e.file.startsWith(`${seamsPrefix}/`))
            .map(e => ({ ...e, file: e.file.slice(seamsPrefix.length + 1) }));
        return evidence.length ? { ...f, evidence } : null;
    };
    const findings = bySeverity(d.findings.map(own).filter(f => f !== null));
    const rules = [...new Set(findings.map(f => f.checklistItem ?? "other"))].map((id): SarifRule => {
        const rule = { id, name: id, shortDescription: { text: titles.get(id) ?? id } };
        if (!SECURITY_ITEM.test(id)) return rule;
        const worst = findings
            .filter(f => f.checklistItem === id)
            .map(f => f.severity ?? "info")
            .reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), "info");
        const score = SECURITY_SEVERITY[worst];
        return { ...rule, properties: { tags: ["security"], ...(score ? { "security-severity": score } : {}) } };
    });
    return {
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
        runs: [
            {
                tool: { driver: { name: "Auditdesk", informationUri: "https://github.com/anaidenko/auditdesk", rules } },
                results: findings.flatMap(byPlace).map(({ f, place }) => ({
                    ruleId: f.checklistItem ?? "other",
                    level: LEVEL[f.severity ?? "info"],
                    message: { text: `${f.title.replace(/[.!?]+$/, "")}. ${f.summary}` },
                    locations: (place ? [place] : f.evidence).map(e => ({
                        physicalLocation: {
                            artifactLocation: { uri: e.file.split("/").map(encodeURIComponent).join("/"), uriBaseId: "%SRCROOT%" as const },
                            region: { startLine: e.startLine, endLine: e.endLine }
                        }
                    })),
                    partialFingerprints: { "auditdesk/finding": f.label, ...(place ? { "auditdesk/place": place.key! } : {}) },
                    properties: {
                        label: f.label,
                        severity: f.severity,
                        aspect: f.aspect,
                        ...(f.references.cwe ? { cwe: f.references.cwe } : {})
                    }
                })),
                properties: { repository: repo.name, branch: repo.branch, commit: repo.sha }
            }
        ]
    };
}

export interface IssueDraft {
    title: string;
    body: string;
    labels: string[];
    severity: SeverityName | null;
}

const link = (r: Ref) => (r.url ? `[${r.label}](${r.url})` : r.label);

/** A delimiter of backticks longer than any run in the text, as CommonMark requires to contain it. */
const ticks = (text: string, min: number) => "`".repeat(Math.max(min, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));

const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

/**
 * Plain text from a finding as Markdown that says the same: the report shows these fields as text,
 * so `__proto__` or `<div>` must not turn into emphasis or a tag. The model's inline code is kept.
 */
function prose(text: string): string {
    const escape = (s: string) => s.replace(/[\\*_<>[\]|~]/g, "\\$&").replace(/^(\s*)#/gm, "$1\\#");
    let out = "";
    let at = 0;
    for (const m of text.matchAll(CODE_SPAN)) {
        out += escape(text.slice(at, m.index)) + m[0];
        at = m.index + m[0].length;
    }
    return out + escape(text.slice(at));
}

const code = (s: string) => {
    const t = ticks(s, 1);
    return t.length > 1 ? `${t} ${s} ${t}` : `\`${s}\``;
};

function body(f: ReportFinding): string {
    const refs = f.refs
        ? [f.refs.top10, f.refs.cwe, ...f.refs.asvs, ...f.refs.wcag, ...f.refs.cheatsheets, ...f.refs.advisories, f.refs.nist]
        : [];
    const lines = [
        `**Severity:** ${f.severity ?? "question"} · **Checklist item:** ${f.checklistItem ?? "none"} · **Repository:** ${prose(f.repository)}${
            f.effort ? ` · **Effort:** ${f.effort}` : ""
        }`,
        "",
        prose(f.summary),
        "",
        "### Details",
        "",
        prose(f.explanation),
        ...(f.likelihood || f.impact
            ? ["", `**Likelihood:** ${prose(f.likelihood ?? "not stated")}`, `**Impact:** ${prose(f.impact ?? "not stated")}`]
            : []),
        "",
        "### Evidence",
        "",
        ...f.evidence.flatMap(e => [
            `${code(e.file)}, ${e.startLine === e.endLine ? `line ${e.startLine}` : `lines ${e.startLine}–${e.endLine}`}`,
            ...(e.snippet ? ["", ticks(e.snippet, 3), e.snippet, ticks(e.snippet, 3)] : []),
            ""
        ]),
        "### Recommendation",
        "",
        prose(f.recommendation),
        ...(refs.some(Boolean) ? ["", "### References", "", ...refs.filter((r): r is Ref => !!r).map(r => `- ${link(r)}`)] : []),
        "",
        `_From the Auditdesk report, finding ${f.label}._`
    ];
    return lines.join("\n");
}

/**
 * One tracker issue per reported finding, worst first so a tracker that numbers by creation puts
 * them in the report's order. For GitHub, Linear or any tracker that takes Markdown.
 */
export function issueDrafts(d: ReportData): IssueDraft[] {
    return bySeverity(d.findings).map(f => ({
        title: `${f.label}: ${f.title}`,
        body: body(f),
        labels: ["audit", f.severity ?? "question", f.aspect.toLowerCase().replace(/[^a-z0-9]+/g, "-")],
        severity: f.severity
    }));
}

const PRIORITY: Record<SeverityName, string> = { critical: "Urgent", high: "High", medium: "Medium", low: "Low", info: "No priority" };

/**
 * The drafts as RFC 4180 CSV with every field quoted: Title, Description, Priority (Linear's names)
 * and Labels, separated by ", " as Linear's CSV importer splits them.
 */
export function issuesCsv(drafts: IssueDraft[]): string {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
        ["Title", "Description", "Priority", "Labels"].map(q).join(","),
        ...drafts.map(i => [i.title, i.body, PRIORITY[i.severity ?? "info"], i.labels.join(", ")].map(q).join(","))
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

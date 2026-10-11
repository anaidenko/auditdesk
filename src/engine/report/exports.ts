import { AUDITOR } from "../ai-policy";
import { SEAMS, aspectTitle } from "../aspects";
import { SIZES, formatHours } from "../effort";
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
const SECURITY_ITEM = /^(SEC|MOB|DEP|LLM|TEN)-/;
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
            properties: { label: string; severity: SeverityName | null; aspect: string; cwe?: string; unreviewed?: true };
        }[];
        properties: { repository: string; branch: string; commit: string; draft?: true };
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
 * the report. A draft marks what the auditor has not reviewed in the message, which is what an alert
 * shows, as well as in the properties.
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
                results: findings.flatMap(byPlace).map(({ f, place }) => {
                    const places = place ? [place] : f.evidence;
                    const history = [...new Set(places.filter(e => e.commit).map(e => `${e.commit!.slice(0, 8)}, line ${e.startLine}`))];
                    return {
                        ruleId: f.checklistItem ?? "other",
                        level: LEVEL[f.severity ?? "info"],
                        message: {
                            text: `${f.unreviewed ? "Not reviewed yet: " : ""}${f.title.replace(/[.!?]+$/, "")}. ${f.summary}${history.length ? ` Found in git history at ${history.join("; ")}.` : ""}`
                        },
                        // A place only in history points at its file's first line, as GitHub requires a region; its own
                        // line, named in the message with the commit, may hold other code today.
                        locations: places.map(e => ({
                            physicalLocation: {
                                artifactLocation: {
                                    uri: e.file.split("/").map(encodeURIComponent).join("/"),
                                    uriBaseId: "%SRCROOT%" as const
                                },
                                region: e.commit ? { startLine: 1, endLine: 1 } : { startLine: e.startLine, endLine: e.endLine }
                            }
                        })),
                        partialFingerprints: { "auditdesk/finding": f.label, ...(place ? { "auditdesk/place": place.key! } : {}) },
                        properties: {
                            label: f.label,
                            severity: f.severity,
                            aspect: f.aspect,
                            ...(f.references.cwe ? { cwe: f.references.cwe } : {}),
                            ...(f.unreviewed && { unreviewed: true as const })
                        }
                    };
                }),
                properties: { repository: repo.name, branch: repo.branch, commit: repo.sha, ...(d.draft && { draft: true as const }) }
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
    // A backtick CODE_SPAN did not pair would open a fence or a span; a line of - or = would make the line above a heading.
    const escape = (s: string) =>
        s
            .replace(/[\\*_<>[\]|~`]/g, "\\$&")
            .replace(/^(\s*)#/gm, "$1\\#")
            .replace(/^(\s*)([-=])(?=[-=\s]*$)/gm, "$1\\$2");
    let out = "";
    let at = 0;
    for (const m of text.matchAll(CODE_SPAN)) {
        out += escape(text.slice(at, m.index)) + m[0];
        at = m.index + m[0].length;
    }
    return out + escape(text.slice(at));
}

/** Inline code, on one line: a newline in a client's path or pattern would end the span and start a heading. */
const code = (raw: string) => {
    const s = raw.replace(/\r?\n/g, " ");
    const t = ticks(s, 1);
    return t.length > 1 ? `${t} ${s} ${t}` : `\`${s}\``;
};

/** An issue has no legend, so the size says what it means, or the hours when the export includes them. */
function effortGloss(f: ReportFinding): string {
    const gloss = f.effortHours ? formatHours(f.effortHours) : SIZES.find(s => s.size === f.effort)?.span;
    return gloss ? `${f.effort} (${gloss})` : `${f.effort}`;
}

/** Andrii's call per finding wins; otherwise critical and high come before sign-off (design § 10), as in the report. */
const beforeSignoff = (f: ReportFinding) => f.fixBeforeSignoff ?? (f.severity === "critical" || f.severity === "high");

/** A place in the code, and when it lies only in git history, the commit it was found at. */
const place = (e: Evidence) =>
    `${code(e.file)}, ${e.startLine === e.endLine ? `line ${e.startLine}` : `lines ${e.startLine}–${e.endLine}`}${
        e.commit ? ` (in git history at ${code(e.commit.slice(0, 8))}, not in the audited tree)` : ""
    }`;

/** The first line of a finding: its severity, checklist item, repository and effort, and `extra`. */
const meta = (f: ReportFinding, extra: string[] = []) =>
    `**Severity:** ${f.severity ?? "question"} · **Checklist item:** ${f.checklistItem ?? "none"} · **Repository:** ${prose(f.repository)}${
        f.effort ? ` · **Effort:** ${effortGloss(f)}` : ""
    }${extra.map(x => ` · ${x}`).join("")}`;

/**
 * A finding as Markdown: its fields under `h` headings, below the caller's own heading for the
 * finding; `extra` joins the first line, and the footer names the report for an issue that stands
 * alone.
 */
function body(f: ReportFinding, o: { h?: string; extra?: string[]; footer?: boolean } = {}): string {
    const h = o.h ?? "###";
    const refs = f.refs
        ? [
              f.refs.top10,
              f.refs.cwe,
              ...f.refs.asvs,
              ...f.refs.wcag,
              ...f.refs.masvs,
              ...f.refs.cheatsheets,
              ...f.refs.advisories,
              f.refs.nist
          ]
        : [];
    const lines = [
        ...(f.unreviewed
            ? ["**Not reviewed yet:** the auditor has not reviewed this finding; it comes from a draft of the report.", ""]
            : []),
        meta(f, o.extra),
        "",
        prose(f.summary),
        "",
        `${h} Details`,
        "",
        prose(f.explanation),
        ...(f.likelihood || f.impact
            ? ["", `**Likelihood:** ${prose(f.likelihood ?? "not stated")}`, `**Impact:** ${prose(f.impact ?? "not stated")}`]
            : []),
        "",
        `${h} Evidence`,
        "",
        ...f.evidence.flatMap(e => [place(e), ...(e.snippet ? ["", ticks(e.snippet, 3), e.snippet, ticks(e.snippet, 3)] : []), ""]),
        `${h} Recommendation`,
        "",
        prose(f.recommendation),
        ...(refs.some(Boolean) ? ["", `${h} References`, "", ...refs.filter((r): r is Ref => !!r).map(r => `- ${link(r)}`)] : []),
        ...(o.footer === false ? [] : ["", `_From the Auditdesk report, finding ${f.label}._`])
    ];
    return lines.join("\n");
}

/**
 * One tracker issue per reported finding, worst first so a tracker that numbers by creation puts
 * them in the report's order. For GitHub, Linear or any tracker that takes Markdown. A draft marks
 * what the auditor has not reviewed in the title, which is what a tracker's list shows, as well as
 * in the body and the labels.
 */
export function issueDrafts(d: ReportData): IssueDraft[] {
    return bySeverity(d.findings).map(f => ({
        title: `${f.label}${f.unreviewed ? " (not reviewed)" : ""}: ${f.title}`,
        body: body(f),
        labels: [
            "audit",
            f.severity ?? "question",
            f.aspect.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            ...(f.unreviewed ? ["not-reviewed"] : [])
        ],
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

const RECHECK: Partial<Record<NonNullable<ReportFinding["recheck"]>, string>> = {
    regressed: "regressed since the last audit",
    changed: "the cited code changed since the last audit; check it before you act"
};

/** "certs/ (2 files)" as the path in code and its count as text; "and 3 more" as it is. */
const area = (x: string) => {
    const m = /^(.+?)( \(\d+ files?\))?$/.exec(x)!;
    return /^and \d+ more$/.test(x) ? x : `${code(m[1])}${m[2] ?? ""}`;
};

/** Per repository, what the client keeps from AI tools, and the patterns that say so: an agent fixing the code keeps off them too. */
function keptFromAi(d: ReportData): string[] {
    return d.repositories.flatMap(r => {
        const p = r.aiPolicy;
        if (!p?.sources.length && !p?.warnings.length) return [];
        // A policy Auditdesk could not read in full is no all-clear: the team says what else stays out.
        const warnings = p.warnings.map(
            w => `  - Auditdesk could not use part of this policy: ${prose(w)} Ask the team which files to keep away from.`
        );
        if (p.everything) return [`- In ${prose(r.name)}: every file.`, ...warnings];
        // As the report names them (render.ts, exclusions): a nested file its tool reads only at the root.
        const by = (s: (typeof p.sources)[number]) =>
            s.intent
                ? "the team's intent; no tool reads it"
                : s.nested
                  ? `${prose(s.tool)}; a nested file, which ${prose(s.tool)} reads only at the root`
                  : prose(s.tool);
        const patterns = p.sources.flatMap(s =>
            s.patterns
                .filter(x => x.note !== "outside the repository, not applicable")
                .map(x => {
                    const what =
                        s.file === AUDITOR
                            ? `${code(x.pattern)}, agreed with the client`
                            : `${code(x.pattern)} in ${code(s.file)} (${by(s)})`;
                    const note = x.pattern.startsWith("!") ? ": a negation, so these stay readable" : x.note ? ` (${prose(x.note)})` : "";
                    return `  - ${what}${note}`;
                })
        );
        return [
            `- In ${prose(r.name)}: ${p.excluded.length ? p.excluded.map(area).join(", ") : "no file at this commit"}`,
            ...patterns,
            ...warnings
        ];
    });
}

/** Where a finding in a file the client keeps from AI tools is, and nothing it says about the code. */
function keptCard(f: ReportFinding, extra: string[]): string {
    return [
        meta(f, extra),
        "",
        "In a file the client keeps from AI tools: leave it to the team. Its details are in the report.",
        "",
        ...f.evidence.map(e => `- ${place(e)}`)
    ].join("\n");
}

/**
 * The report for an AI coding agent that works on the audited code: one Markdown file with the
 * audited commits, how to work through the findings, the files the client keeps from AI tools,
 * then every reported finding worst first under its stable ID, and the open questions apart.
 * It honours the export's boxes as the issues do: a draft's unreviewed marked, hours when ticked.
 */
export function agentMarkdown(d: ReportData): string {
    const findings = bySeverity(d.findings);
    const questions = [...d.questions].sort((a, b) => number(a) - number(b));
    const fixFirst = findings.filter(beforeSignoff);
    const canWait = findings.filter(f => !beforeSignoff(f));
    const kept = keptFromAi(d);
    const labels = (list: ReportFinding[]) => (list.length ? list.map(f => f.label).join(", ") : "none");
    const waiting = [findings, questions].map(list => list.filter(f => f.unreviewed).length);
    const draftParts = [
        ...(waiting[0] ? [`${waiting[0]} of ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`] : []),
        ...(waiting[1] ? [`${waiting[1]} of ${questions.length} open ${questions.length === 1 ? "question" : "questions"}`] : [])
    ];
    // The title is the model's or a scanner's words about the code, so a kept file's finding goes untitled, as in the agents' index.
    const heading = (f: ReportFinding) =>
        `### ${f.label}${f.unreviewed ? " (not reviewed)" : ""}: ${f.aiExcluded ? "A finding in a file the client keeps from AI tools" : prose(f.title)}`;
    const card = (f: ReportFinding, question: boolean) => {
        const extra = question ? [] : [`**Fix before sign-off:** ${beforeSignoff(f) ? "yes" : "no"}`];
        const recheck = f.recheck ? RECHECK[f.recheck] : undefined;
        return [
            heading(f),
            "",
            f.aiExcluded ? keptCard(f, extra) : body(f, { h: "####", extra, footer: false }),
            ...(recheck ? ["", `**Re-audit:** ${recheck}`] : []),
            ""
        ];
    };
    const repos = d.repositories.flatMap(r => [
        `- ${prose(r.name)} · branch ${prose(r.branch)} · commit ${r.sha}`,
        ...(r.notCovered.length ? [`  - Not covered by this audit: ${prose(r.notCovered.join(", "))}.`] : [])
    ]);
    const lines = [
        `# Code audit: ${prose(d.projectName)}`,
        "",
        `The findings of a code audit, for an AI coding agent working on the audited code. Exported by Auditdesk on ${d.generatedAt}${
            d.auditor ? ` from the audit by ${prose(d.auditor)}` : ""
        }.`,
        ...(d.draft && draftParts.length
            ? [
                  "",
                  `A draft: ${draftParts.join(" and ")} ${waiting[0] + waiting[1] === 1 ? "is" : "are"} not reviewed by the auditor yet, each marked “not reviewed”.`
              ]
            : []),
        "",
        "## How to work through it",
        "",
        "- The findings run worst first, and their IDs (F-012) stay the same through re-audits: name the ID in the commit or pull request that fixes one.",
        "- Each finding cites files and lines at the commit listed under Audited code, or at a commit in git history where it says so. Read the cited code first; if it no longer matches, say so rather than guess.",
        "- Fix what the recommendation describes, with a test where the code has tests, and leave unrelated code as it is.",
        "- Start with the findings to fix before sign-off.",
        ...(d.draft && waiting[0] + waiting[1]
            ? ["- A finding marked “not reviewed” is the tools' claim, not yet the auditor's: confirm it in the code before you act on it."]
            : []),
        ...(questions.length ? ["- Open questions need an answer from the team: do not settle one by assumption."] : []),
        ...(kept.length ? ["- The client keeps some files from AI tools, listed below: do not open them."] : []),
        "",
        "## Audited code",
        "",
        ...repos,
        ...(d.seamsPaths?.length
            ? [
                  "",
                  `The seams pass's paths start with their repository: ${d.seamsPaths.map(p => `${code(`${p.path}/`)} is ${prose(p.repository)}`).join(", ")}.`
              ]
            : []),
        // An aspect's title names its repository; the list above names them already.
        ...(d.aspects.length
            ? ["", `Aspects examined: ${prose([...new Set(d.aspects.map(a => (a.key ? aspectTitle(a.key) : a.title)))].join(", "))}.`]
            : []),
        ...(kept.length
            ? [
                  "",
                  "## Files kept from AI tools",
                  "",
                  "The client keeps these files from AI tools. Do not open, quote or change them; if a fix needs one, say so and leave it to the team.",
                  "",
                  ...kept
              ]
            : []),
        "",
        "## Summary",
        "",
        `- Fix before sign-off: ${labels(fixFirst)}`,
        `- Can wait: ${labels(canWait)}`,
        ...(questions.length ? [`- Open questions: ${labels(questions)}`] : []),
        "",
        "## Findings",
        "",
        ...(findings.length ? findings.flatMap(f => card(f, false)) : ["No finding is reported.", ""]),
        ...(questions.length
            ? [
                  "## Open questions",
                  "",
                  "Points the code alone could not settle; each needs an answer from the team.",
                  "",
                  ...questions.flatMap(f => card(f, true))
              ]
            : [])
    ];
    return `${lines.join("\n").trimEnd()}\n`;
}

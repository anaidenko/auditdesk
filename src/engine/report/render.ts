import { compareFindings } from "../findings";
import { SEVERITIES } from "../types";

import type { ReportData, ReportFinding } from "./types";

const CSS = `
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18181b;max-width:960px;margin:2rem auto;padding:0 1.5rem}
h1{font-size:1.9rem;margin:0 0 .25rem}h2{margin-top:2.5rem;border-bottom:1px solid #e4e4e7;padding-bottom:.25rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #e4e4e7;vertical-align:top}
pre{background:#f4f4f5;padding:.6rem;overflow-x:auto;font-size:.8rem;white-space:pre-wrap}
details{border:1px solid #e4e4e7;border-radius:6px;margin:.75rem 0;padding:.5rem .9rem}summary{cursor:pointer;font-weight:600}
.sev{display:inline-block;min-width:4.5rem;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
.critical{color:#991b1b}.high{color:#c2410c}.medium{color:#a16207}.low{color:#1d4ed8}.info{color:#52525b}
.muted{color:#71717a}@media print{details{break-inside:avoid}summary{list-style:none}}
`;

const COVERAGE: Record<string, string> = { examined: "examined", partly: "partly examined", not_examined: "not examined" };

/**
 * Every value from the database or the client's code goes through here. A template, not
 * react-dom/server: Next.js rejects that import in Route Handler and instrumentation bundles.
 */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeHtml;

function finding(f: ReportFinding): string {
    const meta = [f.repository, f.aspect, f.checklistItem, f.effort && `effort ${f.effort}${f.effortHours ? ` (${f.effortHours} h)` : ""}`]
        .filter(Boolean)
        .join(" · ");
    const refs = [f.references.cwe, ...(f.references.advisories ?? [])].filter(Boolean).join(", ");
    return `<details open id="${e(f.label)}">
<summary><span class="sev ${e(f.severity ?? "info")}">${e(f.severity ?? "question")}</span> ${e(f.label)} · ${e(f.title)}</summary>
<p class="muted">${e(meta)}</p>
<p>${e(f.summary)}</p>
${f.likelihood ? `<p><b>Likelihood.</b> ${e(f.likelihood)}</p>` : ""}
${f.impact ? `<p><b>Impact.</b> ${e(f.impact)}</p>` : ""}
<p style="white-space:pre-wrap">${e(f.explanation)}</p>
${f.evidence
    .map(
        ev =>
            `<div><p class="muted">${e(ev.file)}, lines ${ev.startLine}–${ev.endLine}</p>${ev.snippet ? `<pre>${e(ev.snippet)}</pre>` : ""}</div>`
    )
    .join("\n")}
<p><b>Recommendation.</b> ${e(f.recommendation)}</p>
${refs ? `<p class="muted">References: ${e(refs)}</p>` : ""}
</details>`;
}

export function renderReport(d: ReportData): string {
    const findings = [...d.findings].sort((a, b) => compareFindings({ ...a, number: 0 }, { ...b, number: 0 }));
    const count = (s: string) => findings.filter(f => f.severity === s).length;
    const top = findings.filter(f => f.severity === "critical" || f.severity === "high");
    const aspects = d.aspects
        .map(
            a => `<div><h3>${e(a.title)}: ${e(a.status)}</h3>
${a.note ? `<p>${e(a.note)}</p>` : ""}
<table><tbody>${a.coverage.map(c => `<tr><td>${e(c.item)}</td><td>${e(c.title)}</td><td>${e(COVERAGE[c.status] ?? c.status)}</td></tr>`).join("")}</tbody></table></div>`
        )
        .join("\n");
    const tools = d.toolVersions
        ? `<p>Scanners: ${e(
              Object.values(d.toolVersions.images)
                  .map(i => i.digest || i.image)
                  .join(", ")
          )}. Semgrep rulesets: ${e(d.toolVersions.rulesets.map(r => `${r.name} (${r.rules} rules, sha256 ${r.sha256.slice(0, 12)})`).join(", "))}. OSV queried ${e(
              d.toolVersions.osvQueriedAt.slice(0, 10)
          )}.</p>`
        : "";
    const rows = findings
        .map(
            f =>
                `<tr><td><a href="#${e(f.label)}">${e(f.label)}</a></td><td class="${e(f.severity ?? "")}">${e(f.severity ?? "")}</td><td>${e(f.title)}</td><td>${e(f.aspect)}</td><td>${e(f.repository)}</td></tr>`
        )
        .join("");
    const questions = d.questions.length ? `<h2>Open questions</h2>\n${d.questions.map(finding).join("\n")}` : "";

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(`Code audit: ${d.projectName}`)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>Code audit: ${e(d.projectName)}</h1>
<p class="muted">${e(d.generatedAt)} · ${e(d.auditor)}</p>
<p>${e(d.repositories.map(r => `${r.name} (${r.branch}, ${r.sha.slice(0, 10)})`).join(" · "))}</p>

<h2>Summary</h2>
<p>${SEVERITIES.map(s => `${count(s)} ${s}`).join(" · ")}</p>
<ul>${top.map(f => `<li><a href="#${e(f.label)}">${e(f.label)}</a> ${e(f.title)}</li>`).join("")}</ul>

<h2>Scope and method</h2>
${aspects}
<p>The client's code was read, not installed, built or run: no dependency install, no type-check, no project lint.</p>
<p>Models that served calls: ${e(d.servedModels.join(", ") || "none")}.</p>
${tools}
<p>Budgets are checked between model calls; a call in progress may exceed its share by its own cost.</p>

<h2>Findings</h2>
<table><thead><tr><th>ID</th><th>Severity</th><th>Title</th><th>Aspect</th><th>Repository</th></tr></thead><tbody>${rows}</tbody></table>
${findings.map(finding).join("\n")}
${questions}

<h2>Disclaimer</h2>
<p>An audit finds issues; it does not certify their absence. Findings describe the code at the commits listed above.</p>
</body>
</html>
`;
}

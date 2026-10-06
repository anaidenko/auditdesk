import { compareFindings } from "../findings";
import type { Ref } from "../references";
import { type ModelAccess, SEVERITIES } from "../types";

import type { ReportData, ReportFinding } from "./types";

// The app's palette (zinc, an indigo accent) on paper: light only, system fonts, nothing fetched.
const CSS = `
:root{--ink:#18181b;--muted:#71717a;--faint:#a1a1aa;--line:#e4e4e7;--wash:#fafafa;--accent:#4f46e5;
--critical:#b91c1c;--critical-bg:#fef2f2;--high:#c2410c;--high-bg:#fff7ed;--medium:#a16207;--medium-bg:#fefce8;
--low:#1d4ed8;--low-bg:#eff6ff;--info:#52525b;--info-bg:#f4f4f5;--question:#6d28d9;--question-bg:#f5f3ff}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#f4f4f5;color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.doc{max-width:880px;margin:2.5rem auto;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);padding:3rem 3.25rem}
h1,h2,h3,h4{line-height:1.25;letter-spacing:-.01em}
h2{font-size:1.35rem;margin:0 0 1.1rem;padding-bottom:.55rem;border-bottom:1px solid var(--line)}
h3{font-size:1.02rem;margin:1.6rem 0 .6rem}
h4{font-size:.72rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:1.2rem 0 .35rem}
p{margin:.45rem 0}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code{font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
section{margin-top:3rem}
.eyebrow{font-size:.75rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.muted{color:var(--muted)}
.cover h1{font-size:2.3rem;margin:.4rem 0 .3rem}
.cover .lede{font-size:1.05rem;color:var(--muted);margin:0 0 1.8rem}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1rem 2rem;margin:0 0 2rem;padding:1.1rem 1.25rem;background:var(--wash);border:1px solid var(--line);border-radius:10px}
.facts dt{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.facts dd{margin:.2rem 0 0}.facts ul{margin:0;padding:0;list-style:none}
.facts .repos{grid-column:1/-1}.facts .repos li{margin:.15rem 0}
.tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:.6rem}
.tile{border-radius:10px;padding:.75rem .9rem;border:1px solid transparent}
.tile b{display:block;font-size:1.75rem;line-height:1.1;font-variant-numeric:tabular-nums}
.tile span{font-size:.75rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.tile.zero{opacity:.45}
.toc ol{margin:0;padding-left:1.2rem}.toc>ol>li{margin:.45rem 0;font-weight:600}
.toc ul{list-style:none;padding:0;margin:.4rem 0 .7rem;font-weight:400;font-size:.9rem}
.toc ul li{display:flex;gap:.6rem;align-items:baseline;margin:.25rem 0;break-inside:avoid}
.toc .toc-repo{margin:.6rem 0 0;font-size:.9rem}
h3.repo{margin:1.8rem 0 .8rem;padding-bottom:.35rem;border-bottom:1px solid var(--line);break-after:avoid}
.badge{flex-shrink:0;display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.12rem .5rem;border-radius:999px;white-space:nowrap;vertical-align:.1em}
${["critical", "high", "medium", "low", "info", "question"].map(s => `.${s}{color:var(--${s});background:var(--${s}-bg)}.tile.${s}{border-color:var(--${s}-bg)}`).join("")}
.risks{list-style:none;padding:0;margin:.5rem 0}.risks li{display:flex;gap:.7rem;align-items:baseline;padding:.5rem 0;border-bottom:1px solid var(--line)}
.fid{flex-shrink:0;white-space:nowrap;font:600 12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th{text-align:left;font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding:.5rem .6rem;border-bottom:1px solid var(--line)}
td{padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}td.nowrap{white-space:nowrap}
.aspect{border:1px solid var(--line);border-radius:10px;padding:.2rem 1.1rem 1rem;margin:1rem 0}
.pill{display:inline-block;font-size:.72rem;font-weight:600;padding:.08rem .5rem;border-radius:999px;background:var(--info-bg);color:var(--info);white-space:nowrap}
.pill.examined,.pill.done{background:#ecfdf5;color:#047857}.pill.partly,.pill.partial{background:var(--medium-bg);color:var(--medium)}
.pill.declined,.pill.failed,.pill.stopped{background:var(--critical-bg);color:var(--critical)}
.method{padding-left:1.1rem}.method li{margin:.3rem 0}
.finding{border:1px solid var(--line);border-left:4px solid var(--info);border-radius:10px;margin:1.1rem 0;background:#fff}
${["critical", "high", "medium", "low", "info", "question"].map(s => `.finding.sev-${s}{border-left-color:var(--${s})}`).join("")}
.finding summary{display:flex;gap:.7rem;align-items:baseline;padding:.85rem 1.1rem;cursor:pointer;list-style:none;font-weight:600}
.finding summary::-webkit-details-marker{display:none}
.finding .body{padding:0 1.1rem 1rem;border-top:1px solid var(--line)}
.meta{font-size:.82rem;color:var(--muted);margin-top:.8rem}
.lead{font-size:1.02rem}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}.pair.one{grid-template-columns:1fr}
.prose{white-space:pre-wrap}
figure{margin:.6rem 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
figcaption{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);background:var(--wash);padding:.4rem .7rem;border-bottom:1px solid var(--line)}
pre{margin:0;padding:.6rem 0;background:#fcfcfd;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
pre code{display:block}.ln{display:inline-block;width:3.4em;padding-right:.9em;text-align:right;color:var(--faint);user-select:none}
.callout{background:#eef2ff;border:1px solid #e0e7ff;border-radius:8px;padding:.15rem .95rem .6rem;margin:1rem 0 .4rem}.callout h4{color:var(--accent)}
.refs{font-size:.82rem;color:var(--muted)}
.disclaimer{font-size:.92rem;color:var(--muted)}
.colophon{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.78rem;color:var(--faint)}
@page{size:A4;margin:16mm 15mm 18mm}
@media print{
body{background:#fff;font-size:10.5pt}
.doc{max-width:none;margin:0;border:0;border-radius:0;box-shadow:none;padding:0}
.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:center;break-after:page}
section{margin-top:2.2rem}
section#findings,section#questions{margin-top:0;break-before:page}
h2,h3,h4,summary,figcaption{break-after:avoid}
.finding{break-inside:avoid;-webkit-box-decoration-break:clone;box-decoration-break:clone}.finding summary,.pair,.callout,figure{break-inside:avoid}
tr,.risks li{break-inside:avoid}
a{color:inherit}
}
`;

const COVERAGE: Record<string, string> = {
    examined: "examined",
    partly: "partly examined",
    not_examined: "not examined",
    not_reported: "not reported (the agent stopped first)"
};

/**
 * Every value from the database or the client's code goes through here. A template, not
 * react-dom/server: Next.js rejects that import in Route Handler and instrumentation bundles.
 */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeHtml;

// The client's report says which terms their code went under (plan, Decision for Andrii 3).
const ACCESS_TEXT: Record<ModelAccess, string> = {
    api_key: "the Claude API, under Anthropic's Commercial Terms",
    claude_plan: "a Claude subscription through the Claude Agent SDK, under Anthropic's Consumer Terms"
};

const severityOf = (f: ReportFinding) => f.severity ?? "question";
const badge = (f: ReportFinding) => `<span class="badge ${e(severityOf(f))}">${e(severityOf(f))}</span>`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function evidence(ev: ReportFinding["evidence"][number]): string {
    const lines = (ev.snippet ?? "").split("\n");
    const code = lines.map((line, i) => `<span class="ln">${ev.startLine + i}</span>${e(line)}`).join("\n");
    const where = ev.startLine === ev.endLine ? `line ${ev.startLine}` : `lines ${ev.startLine}–${ev.endLine}`;
    return `<figure><figcaption>${e(ev.file)} · ${where}</figcaption>${ev.snippet ? `<pre><code>${code}</code></pre>` : ""}</figure>`;
}

function finding(f: ReportFinding): string {
    const meta = [f.repository, f.aspect, f.checklistItem, f.effort && `effort ${f.effort}${f.effortHours ? ` (${f.effortHours} h)` : ""}`]
        .filter(Boolean)
        .join(" · ");
    const link = (r: Ref) => `<a href="${e(r.url)}">${e(r.label)}</a>`;
    const R = f.refs;
    const refs = R
        ? [
              (R.top10 || R.asvs.length) &&
                  `Relevant to: ${[R.top10, ...R.asvs]
                      .filter((r): r is Ref => !!r)
                      .map(link)
                      .join("; ")}.`,
              R.cwe && `Weakness: ${link(R.cwe)}.`,
              R.advisories.length && `Advisories: ${R.advisories.map(link).join(", ")}.`,
              (R.cheatsheets.length || R.nist) &&
                  `Further reading: ${[...R.cheatsheets, R.nist]
                      .filter((r): r is Ref => !!r)
                      .map(link)
                      .join("; ")}.`
          ].filter(Boolean)
        : [[f.references.cwe, ...(f.references.advisories ?? [])].filter(Boolean).join(", ")].filter(Boolean).map(e);
    const pair =
        f.likelihood || f.impact
            ? `<div class="pair${f.likelihood && f.impact ? "" : " one"}">${f.likelihood ? `<div><h4>Likelihood</h4><p>${e(f.likelihood)}</p></div>` : ""}${f.impact ? `<div><h4>Impact</h4><p>${e(f.impact)}</p></div>` : ""}</div>`
            : "";
    return `<details open id="${e(f.label)}" class="finding sev-${e(severityOf(f))}">
<summary>${badge(f)}<span class="fid">${e(f.label)}</span><span>${e(f.title)}</span></summary>
<div class="body">
<p class="meta">${e(meta)}</p>
<p class="lead">${e(f.summary)}</p>
${pair}
<h4>Details</h4>
<p class="prose">${e(f.explanation)}</p>
${f.evidence.length ? `<h4>Evidence</h4>\n${f.evidence.map(evidence).join("\n")}` : ""}
<div class="callout"><h4>Recommendation</h4><p class="prose">${e(f.recommendation)}</p></div>
${refs.length ? `<div class="refs"><h4>References</h4>${refs.map(r => `<p>${r}</p>`).join("")}</div>` : ""}
</div>
</details>`;
}

export function renderReport(d: ReportData): string {
    const number = (f: ReportFinding) => Number(f.label.replace(/\D/g, ""));
    const findings = [...d.findings].sort((a, b) => compareFindings({ ...a, number: number(a) }, { ...b, number: number(b) }));
    const count = (s: string) => findings.filter(f => f.severity === s).length;
    const top = findings.filter(f => f.severity === "critical" || f.severity === "high");
    const tocItems = (list: ReportFinding[]) =>
        list.length
            ? `<ul>${list.map(f => `<li>${badge(f)}<a class="fid" href="#${e(f.label)}">${e(f.label)}</a><span>${e(f.title)}</span></li>`).join("")}</ul>`
            : "";
    // The cover names a single repository; a column repeating it only wraps.
    const manyRepos = d.repositories.length > 1;
    // With several repositories the findings run per repository, in the cover's order (design § 10).
    const names = [...new Set([...d.repositories.map(r => r.name), ...findings.map(f => f.repository)])];
    const ids = new Map<string, string>();
    for (const n of names) {
        const base = `repo-${n.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
        let id = base;
        for (let i = 2; [...ids.values()].includes(id); i++) id = `${base}-${i}`;
        ids.set(n, id);
    }
    // A repository with nothing accepted keeps its heading, or a reader might take it for unaudited.
    const groups = manyRepos ? names.map(n => ({ name: n, list: findings.filter(f => f.repository === n) })) : [];
    const repoHead = (n: string) => `<h3 class="repo" id="${e(ids.get(n)!)}">${e(n)}</h3>`;

    const tiles = SEVERITIES.map(s => `<div class="tile ${s}${count(s) ? "" : " zero"}"><b>${count(s)}</b><span>${s}</span></div>`).join(
        ""
    );
    const repos = d.repositories
        .map(r => `<li>${e(r.name)} <span class="muted">· ${e(r.branch)} ·</span> <code>${e(r.sha.slice(0, 10))}</code></li>`)
        .join("");
    const aspects = d.aspects
        .map(
            a => `<div class="aspect"><h3>${e(a.title)} <span class="pill ${e(a.status)}">${e(a.status)}</span></h3>
${a.note ? `<p>${e(a.note)}</p>` : ""}
${
    a.coverage.length
        ? `<table><thead><tr><th>Item</th><th>Checklist</th><th>Coverage</th></tr></thead><tbody>${a.coverage
              .map(
                  c =>
                      `<tr><td class="nowrap">${e(c.item)}</td><td>${e(c.title)}</td><td class="nowrap"><span class="pill ${e(c.status)}">${e(COVERAGE[c.status] ?? c.status)}</span></td></tr>`
              )
              .join("")}</tbody></table>`
        : ""
}</div>`
        )
        .join("\n");
    const tools = d.toolVersions
        ? `<li>Scanners: ${e(
              Object.values(d.toolVersions.images)
                  .map(i => i.digest || i.image)
                  .join(", ")
          )}. Semgrep rulesets: ${e(d.toolVersions.rulesets.map(r => `${r.name} (${r.rules} rules, sha256 ${r.sha256.slice(0, 12)})`).join(", "))}. OSV queried ${e(
              d.toolVersions.osvQueriedAt.slice(0, 10)
          )}.</li>`
        : "";
    const rows = findings
        .map(
            f =>
                `<tr><td class="nowrap"><a href="#${e(f.label)}">${e(f.label)}</a></td><td>${badge(f)}</td><td>${e(f.title)}</td><td>${e(f.aspect)}</td>${manyRepos ? `<td>${e(f.repository)}</td>` : ""}<td class="nowrap">${e(f.effort ?? "")}</td></tr>`
        )
        .join("");
    const aiBuilt = d.aiBuilt ? [...findings, ...d.questions].filter(f => f.tags?.includes("ai-built")) : [];
    const aiSection = aiBuilt.length
        ? `<section id="ai-built"><h2>Signs of AI-generated code</h2>
<p class="muted">Findings typical of code written largely by AI tools: uneven checks, packages to verify, copies that drifted apart. Each is described in full under Findings.</p>
${tocItems(aiBuilt)}</section>`
        : "";
    const questions = d.questions.length
        ? `<section id="questions"><h2>Open questions</h2>
<p class="muted">Points the code alone could not settle; each needs an answer from the team.</p>
${d.questions.map(finding).join("\n")}</section>`
        : "";

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(`Code audit: ${d.projectName}`)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="doc">
<header class="cover">
<div class="eyebrow">Code audit</div>
<h1>${e(d.projectName)}</h1>
<p class="lede">${plural(findings.length, "finding", "findings")} and ${plural(d.questions.length, "open question", "open questions")} across ${plural(d.repositories.length, "repository", "repositories")}</p>
<dl class="facts">
<div><dt>Date</dt><dd>${e(d.generatedAt)}</dd></div>
<div><dt>Auditor</dt><dd>${e(d.auditor)}</dd></div>
<div class="repos"><dt>Repositories audited (branch, commit)</dt><dd><ul>${repos}</ul></dd></div>
</dl>
<div class="tiles">${tiles}</div>
</header>

<nav class="toc"><h2>Contents</h2><ol>
<li><a href="#summary">Summary</a></li>
<li><a href="#scope">Scope and method</a></li>
<li><a href="#findings">Findings</a>${
        manyRepos
            ? groups.map(g => `<p class="toc-repo"><a href="#${e(ids.get(g.name)!)}">${e(g.name)}</a></p>${tocItems(g.list)}`).join("")
            : tocItems(findings)
    }</li>
${aiBuilt.length ? `<li><a href="#ai-built">Signs of AI-generated code</a></li>` : ""}
${d.questions.length ? `<li><a href="#questions">Open questions</a>${tocItems(d.questions)}</li>` : ""}
<li><a href="#disclaimer">Disclaimer</a></li>
</ol></nav>

<section id="summary"><h2>Summary</h2>
<p>${SEVERITIES.map(s => `${count(s)} ${s}`).join(" · ")}.</p>
<h3>Top risks</h3>
${top.length ? `<ul class="risks">${top.map(f => `<li>${badge(f)}<a class="fid" href="#${e(f.label)}">${e(f.label)}</a><span>${e(f.title)}</span></li>`).join("")}</ul>` : `<p class="muted">No critical or high findings.</p>`}
</section>

<section id="scope"><h2>Scope and method</h2>
${aspects}
<h3>Method</h3>
<ul class="method">
<li>The client's code was read, not installed, built or run: no dependency install, no type-check, no project lint.</li>
<li>Models that served calls: ${e(d.servedModels.join(", ") || "none")}.</li>
<li>Model access: ${d.modelAccess.map(a => ACCESS_TEXT[a]).join("; ") || "none"}.</li>
${tools}
<li>Budgets are checked between model calls; a call in progress may exceed its share by its own cost.</li>
${d.repositories
    .filter(r => r.notCovered.length)
    .map(
        r =>
            `<li>Not covered in ${e(r.name)}: ${e(r.notCovered.join("; "))}. The audit covers JavaScript and TypeScript; these were not analysed.</li>`
    )
    .join("\n")}
</ul>
</section>

<section id="findings"><h2>Findings</h2>
${findings.length ? `<table><thead><tr><th>ID</th><th>Severity</th><th>Title</th><th>Aspect</th>${manyRepos ? "<th>Repository</th>" : ""}<th>Effort</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No findings were accepted for this report.</p>`}
${
    manyRepos
        ? groups
              .map(
                  g =>
                      `${repoHead(g.name)}\n${g.list.length ? g.list.map(finding).join("\n") : `<p class="muted">No findings were accepted for this repository.</p>`}`
              )
              .join("\n")
        : findings.map(finding).join("\n")
}
</section>
${aiSection}
${questions}

<section id="disclaimer"><h2>Disclaimer</h2>
<p class="disclaimer">An audit finds issues; it does not certify their absence. Findings describe the code at the commits listed above.</p>
</section>
<p class="colophon">${e(d.auditor)} · ${e(d.generatedAt)}</p>
</main>
</body>
</html>
`;
}

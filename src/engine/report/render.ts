import { SEAMS, aspectTitle } from "../aspects";
import { limitedReview } from "../coverage";
import { BY_SIZE_TEXT, SIZES, formatHours, formatTotal, totalHours } from "../effort";
import { compareFindings } from "../findings";
import type { Ref } from "../references";
import { shortSha } from "../short-sha";
import { type ModelAccess, SEVERITIES } from "../types";

import type { ReportData, ReportFinding } from "./types";

const SEAMS_TITLE = aspectTitle(SEAMS);

// The app's palette (zinc, an indigo accent) on paper: light only, system fonts, nothing fetched.
// In print a card may run onto the next page; its title, meta line and Recommendation keep together:
// none of them split at 64 page offsets, one line apart (Chromium of playwright-core 1.63, 2026-10-07).
const CSS = `
:root{--ink:#18181b;--muted:#71717a;--faint:#a1a1aa;--line:#e4e4e7;--wash:#fafafa;--accent:#4f46e5;
--critical:#b91c1c;--critical-bg:#fef2f2;--high:#c2410c;--high-bg:#fff7ed;--medium:#a16207;--medium-bg:#fefce8;
--low:#1d4ed8;--low-bg:#eff6ff;--info:#52525b;--info-bg:#f4f4f5;--question:#6d28d9;--question-bg:#f5f3ff}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#f4f4f5;color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.doc{max-width:880px;margin:2.5rem auto;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);padding:3rem 3.25rem}
.doc{overflow-wrap:anywhere}
@media screen and (max-width:640px){.doc{margin:0;border-radius:0;padding:1.75rem 1.1rem}}
h1,h2,h3,h4{line-height:1.25;letter-spacing:-.01em}
h2{font-size:1.35rem;margin:0 0 1.1rem;padding-bottom:.55rem;border-bottom:1px solid var(--line)}
h3{font-size:1.02rem;margin:1.6rem 0 .6rem}
h4{font-size:.72rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:1.2rem 0 .35rem}
p{margin:.45rem 0}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code{font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
section,.toc{margin-top:3rem}
.eyebrow{font-size:.75rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.muted{color:var(--muted)}
.cover h1{font-size:2.3rem;margin:.4rem 0 .3rem}
.cover .lede{font-size:1.05rem;color:var(--muted);margin:0 0 1.8rem}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1rem 2rem;margin:0 0 2rem;padding:1.1rem 1.25rem;background:var(--wash);border:1px solid var(--line);border-radius:10px}
.facts dt{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.facts dd{margin:.2rem 0 0}.facts ul{margin:0;padding:0;list-style:none}
.facts .repos{grid-column:1/-1}.facts .repos li{margin:.15rem 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr));gap:.6rem}
.tile{border-radius:10px;padding:.75rem .9rem;border:1px solid transparent}
.tile b{display:block;font-size:1.75rem;line-height:1.1;font-variant-numeric:tabular-nums}
.tile span{font-size:.75rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.tile.zero{background:transparent;border-color:var(--line)}.tile.zero b,.tile.zero span{color:var(--muted)}
.sums{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.6rem;margin:.6rem 0}
.sum{border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem;background:var(--wash)}
.sum b{display:block;font-size:1.45rem;line-height:1.15;font-variant-numeric:tabular-nums}.sum b.na{font-size:1rem;color:var(--muted)}
.sum span{font-size:.72rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.sum.all{background:#eef2ff;border-color:#e0e7ff}.sum.all b,.sum.all span{color:var(--accent)}
.sum.zero{background:transparent}.sum.zero b{color:var(--muted)}
.sizes{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;padding:0;margin:.8rem 0 .3rem;font-size:.85rem;color:var(--muted)}
.sizes b{display:inline-grid;place-items:center;min-width:1.45rem;height:1.45rem;margin-right:.3rem;border:1px solid var(--line);border-radius:6px;background:var(--wash);color:var(--ink);font-size:.75rem}
.effort .note{font-size:.82rem}
.toc ol{margin:0;padding-left:1.2rem}.toc>ol>li{margin:.45rem 0;font-weight:600}
.toc ul{list-style:none;padding:0;margin:.4rem 0 .7rem;font-weight:400;font-size:.9rem}
.toc ul li{display:flex;gap:.6rem;align-items:baseline;margin:.25rem 0;break-inside:avoid}
h3.repo{margin:1.8rem 0 .8rem;padding-bottom:.35rem;border-bottom:1px solid var(--line);break-after:avoid}
.badge{flex-shrink:0;display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.12rem .5rem;border-radius:999px;white-space:nowrap;vertical-align:.1em}
${["critical", "high", "medium", "low", "info", "question"].map(s => `.${s}{color:var(--${s});background:var(--${s}-bg)}.tile.${s}{border-color:var(--${s}-bg)}`).join("")}
.risks{list-style:none;padding:0;margin:.5rem 0}.risks li{display:flex;gap:.7rem;align-items:baseline;padding:.5rem 0;border-bottom:1px solid var(--line)}
.risks .aside{margin-left:auto;padding-left:.5rem;font-size:.82rem;color:var(--muted);white-space:nowrap}
@media screen and (max-width:640px){.risks li{flex-wrap:wrap}.risks .aside{flex-basis:100%;margin-left:0;padding-left:0;white-space:normal}}
.fid{flex-shrink:0;white-space:nowrap;font:600 12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.coverage{list-style:none;padding:0;margin:.5rem 0}.coverage>li{margin:.7rem 0}.gaps{margin:.3rem 0;padding-left:1.2rem;font-size:.9rem}.gaps li{margin:.15rem 0}
.pill{display:inline-block;font-size:.72rem;font-weight:600;padding:.08rem .5rem;border-radius:999px;background:var(--info-bg);color:var(--info);white-space:nowrap}
.pill.examined,.pill.done{background:#ecfdf5;color:#047857}.pill.partly,.pill.partial,.pill.limited{background:var(--medium-bg);color:var(--medium)}
.pill.declined,.pill.failed,.pill.stopped,.pill.regressed{background:var(--critical-bg);color:var(--critical)}
.pill.unreviewed{background:var(--medium-bg);color:var(--medium)}
.cover .draft{margin:-.8rem 0 1.8rem;padding:.75rem 1rem;border-radius:10px;background:var(--medium-bg);color:var(--medium);font-weight:600}
.method,.tech{padding-left:1.1rem}.method a{text-decoration:underline;text-underline-offset:2px}.method li,.tech li{margin:.3rem 0}
.finding{border:1px solid var(--line);border-left:4px solid var(--info);border-radius:10px;margin:1.1rem 0;background:#fff}
${["critical", "high", "medium", "low", "info", "question"].map(s => `.finding.sev-${s}{border-left-color:var(--${s})}`).join("")}
.finding .head{padding:.85rem 1.1rem .1rem}
.finding .title{display:flex;gap:.7rem;align-items:baseline;margin:0;font-weight:600}
.finding .body{padding:0 1.1rem;border-top:1px solid var(--line)}.finding .body[open]{padding-bottom:1rem}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.body>summary{cursor:pointer;padding:.55rem 0;font-size:.82rem;font-weight:600;color:var(--accent)}
.meta{font-size:.82rem;color:var(--muted);margin-top:.3rem}
.lead{font-size:1.02rem}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}.pair.one{grid-template-columns:1fr}
.prose{white-space:pre-wrap}
figure{margin:.6rem 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
figcaption{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);background:var(--wash);padding:.4rem .7rem;border-bottom:1px solid var(--line)}
pre{margin:0;padding:.6rem 0;background:#fcfcfd;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
pre code{display:block}.ln{display:inline-block;width:3.4em;padding-right:.9em;text-align:right;color:var(--faint);user-select:none}
.callout{background:#eef2ff;border:1px solid #e0e7ff;border-radius:8px;padding:.15rem .95rem .6rem;margin:1rem 0 .4rem}.callout h4{color:var(--accent)}
.refs{font-size:.82rem;color:var(--muted)}
.more>summary{cursor:pointer;margin:.4rem 0;font-size:.82rem;color:var(--accent)}
.cut{margin:0;padding:.3rem .7rem;font-size:.75rem;color:var(--muted);border-top:1px solid var(--line)}
@media screen{.off{display:none!important}}
@media screen{.print-only{display:none}}
.filters{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:end;margin:1rem 0;padding:.8rem 1rem;border:1px solid var(--line);border-radius:10px;font-size:.82rem;color:var(--muted)}
.filters label{display:flex;flex-direction:column;gap:.25rem}
.filters select,.filters input{font:inherit;color:var(--ink);padding:.3rem .5rem;border:1px solid var(--line);border-radius:6px;background:#fff}
.filters button{font:inherit;color:var(--accent);padding:.3rem .7rem;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer}
.filters output{margin-left:auto}
.disclaimer{font-size:.92rem;color:var(--muted)}
.colophon{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.78rem;color:var(--muted)}
@page{size:A4;margin:16mm 15mm 18mm}
@media print{
.filters{display:none}.body>summary{display:none}
body{background:#fff;font-size:10.5pt}
.doc{max-width:none;margin:0;border:0;border-radius:0;box-shadow:none;padding:0}
.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:center;break-after:page}
section{margin-top:2.2rem}
section#findings,section#questions{margin-top:0;break-before:page}
h2,h3,h4,summary,figcaption{break-after:avoid}
.finding{-webkit-box-decoration-break:clone;box-decoration-break:clone}.more[open]>summary .print-only{display:none}
.finding .title,.finding .lead,.pair,.callout,figure{break-inside:avoid}.finding .title,.finding .meta{break-after:avoid}.rest{display:none}
.risks li,.gaps li,.effort{break-inside:avoid}
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
 * What the client reads of an aspect that did not finish. The engine's own note stays in the app: it
 * speaks to the auditor, of the plan's reserve, a re-run or a raw error.
 */
const UNFINISHED: Record<string, string> = {
    partial: "Partly covered: the agent stopped before it had examined every item of its checklist.",
    failed: "Not covered: the agent did not finish this aspect.",
    declined: "Not covered: the model declined to review this aspect.",
    stopped: "Not covered: the audit was stopped before this aspect finished."
};

const STATIC_ONLY: Record<string, string> = {
    performance: "Performance was judged from the code alone: no page was rendered or timed.",
    accessibility:
        "Accessibility was judged from the code alone: no page was rendered and no screen reader was run; contrast was computed only for colour pairs written in the code."
};

/** "a, b and c" */
const listed = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? ""));

/** The audit's steps as they ran: the scanners, an agent per aspect, and what the review made of the findings. */
function method(d: ReportData): string {
    const steps: string[] = [];
    if (d.toolVersions)
        steps.push(
            "Scanners first: gitleaks over the history of every branch cloned, osv-scanner over the lock files and Semgrep; their pinned images are under Technical details."
        );
    if (d.aspects.length)
        steps.push(
            `Then one agent per aspect${d.repositories.length > 1 ? " and repository" : ""} read the code through read-only tools, against the aspect's checklist; Coverage above shows what each examined.`
        );
    const r = d.review;
    if (r?.filed) {
        const outcomes = [
            `${r.reported} ${r.reported === 1 ? "is" : "are"} in this report`,
            ...(r.fixed ? [`${r.fixed} ${r.fixed === 1 ? "was" : "were"} found fixed at a re-audit`] : []),
            ...(r.merged ? [`${r.merged} ${r.merged === 1 ? "was" : "were"} merged into others`] : []),
            ...(r.rejected ? [`${r.rejected} rejected as wrong`] : []),
            ...(r.excluded ? [`${r.excluded} kept out of the report`] : [])
        ];
        const reviewed = r.filed - r.unreviewed;
        const filed = `${plural(r.filed, "finding", "findings")} the scanners and agents filed`;
        // A draft carries the findings awaiting review, marked; the final report leaves them out.
        const awaiting = `${r.unreviewed} not reviewed yet ${r.unreviewed === 1 ? "is" : "are"} ${d.draft ? "in it too, marked “not reviewed”" : "not"}`;
        steps.push(
            reviewed === 0
                ? `None of the ${filed} is reviewed yet${d.draft ? `; ${r.filed === 1 ? "it is" : "all are"} in this draft, marked “not reviewed”` : ""}.`
                : r.unreviewed
                  ? `The auditor reviewed ${reviewed} of the ${filed}: ${listed(outcomes)}; ${awaiting}.`
                  : `The auditor reviewed ${r.filed === 1 ? "the 1 finding" : `all ${r.filed} findings`} the scanners and agents filed: ${listed(outcomes)}.`
        );
    }
    return steps.map(s => `<li>${s}</li>`).join("\n");
}

/** Performance and accessibility read from code: what the report cannot claim for them. */
function staticOnly(d: ReportData): string {
    return Object.entries(STATIC_ONLY)
        .filter(([key]) => d.aspects.some(a => a.key === key))
        .map(([, text]) => `<li>${text}</li>`)
        .join("\n");
}

/**
 * Every value from the database or the client's code goes through here. A template, not
 * react-dom/server: Next.js rejects that import in Route Handler and instrumentation bundles.
 */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeHtml;

/** A link out of the report opens beside it, so a reader keeps their place in a long file. */
const out = (href: string, html: string) => `<a href="${e(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;

// The client's report says which terms their code went under (plan, Decision for Andrii 3).
const ACCESS_TEXT: Record<ModelAccess, string> = {
    api_key: "the Claude API, under Anthropic's Commercial Terms",
    claude_plan: "a Claude subscription through the Claude Agent SDK, under Anthropic's Consumer Terms"
};

const severityOf = (f: ReportFinding) => f.severity ?? "question";
const badge = (f: ReportFinding) => `<span class="badge ${e(severityOf(f))}">${e(severityOf(f))}</span>`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const effortText = (f: ReportFinding) => (f.effort ? `effort ${f.effort}${f.effortHours ? ` (${formatHours(f.effortHours)})` : ""}` : null);

/** The lines of an excerpt a printout shows; the HTML keeps them all. */
const PRINT_LINES = 12;

function evidence(ev: ReportFinding["evidence"][number]): string {
    const lines = (ev.snippet ?? "").split("\n").map((line, i) => `<span class="ln">${ev.startLine + i}</span>${e(line)}`);
    const rest = lines.length - PRINT_LINES;
    const code =
        rest > 0
            ? `${lines.slice(0, PRINT_LINES).join("\n")}<span class="rest">\n${lines.slice(PRINT_LINES).join("\n")}</span>`
            : lines.join("\n");
    const where = ev.startLine === ev.endLine ? `line ${ev.startLine}` : `lines ${ev.startLine}–${ev.endLine}`;
    const cut = rest > 0 ? `<p class="cut print-only">${plural(rest, "more line", "more lines")} in the HTML report</p>` : "";
    return `<figure><figcaption>${e(ev.file)} · ${where}</figcaption>${ev.snippet ? `<pre><code>${code}</code></pre>${cut}` : ""}</figure>`;
}

/** The places a card lists before "and N more": a scanner finding of one rule can cite dozens. */
const SHOWN_PLACES = 10;

function places(list: ReportFinding["evidence"]): string {
    const more = list.slice(SHOWN_PLACES);
    const rest = more.length
        ? `\n<details class="more"><summary>and ${plural(more.length, "more place", "more places")}<span class="print-only"> in the HTML report</span></summary>\n${more.map(evidence).join("\n")}\n</details>`
        : "";
    return `${list.slice(0, SHOWN_PLACES).map(evidence).join("\n")}${rest}`;
}

// The report's one script, reaching nothing outside the file. Expand all, a link to a card and a
// search that matches inside a card open its details; the search closes again what it opened,
// unless the reader used it since, and leaves closed what the reader closed under the same words.
// Print opens every card and gives the reader's state back after; Chromium fires the same two
// events around page.pdf(), so the PDF prints them open too. Filters hide with a class that only
// the screen honours, so a printout is always complete.
const FILTER_SCRIPT = `(()=>{const bodies=[...document.querySelectorAll(".finding>.body")];
let kept=null;
addEventListener("beforeprint",()=>{if(!kept)kept=bodies.map(b=>b.open);for(const b of bodies)b.open=true});
addEventListener("afterprint",()=>{if(kept)bodies.forEach((b,i)=>{b.open=kept[i]});kept=null});
const f=document.querySelector(".filters");const all=f&&f.querySelector(".all");let cur="";
const label=()=>{if(all)all.textContent=bodies.every(b=>b.open)?"Collapse all":"Expand all"};
document.addEventListener("toggle",ev=>{if(bodies.includes(ev.target))label()},true);
if(all)all.addEventListener("click",()=>{const v=!bodies.every(b=>b.open);for(const b of bodies){b.open=v;delete b.dataset.found;if(v)delete b.dataset.shut;else b.dataset.shut=cur}label()});
document.addEventListener("click",ev=>{const s=ev.target.closest&&ev.target.closest(".finding details>summary");if(!s)return;const d=s.parentElement;delete d.dataset.found;if(d.open)d.dataset.shut=cur;else delete d.dataset.shut});
let apply=()=>{};
if(f){const rank={critical:0,high:1,medium:2,low:3,info:4,question:5};
const cards=[...document.querySelectorAll("section#findings .finding")];
const questions=[...document.querySelectorAll("section#questions .finding")];
const groups=[...document.querySelectorAll("section#findings .repo-group")];
const val=n=>{const el=f.querySelector("[name="+n+"]");return el?el.value:""};
const words=c=>[...c.querySelectorAll(":scope>.head,:scope>.body>:not(summary)")].map(x=>x.textContent).join(" ").toLowerCase();
apply=()=>{const min=val("sev"),asp=val("aspect"),repo=val("repo"),q=val("q").trim().toLowerCase();cur=q;const active=!!(min||asp||repo||q);const shown=new Set();let asked=0;
const ok=c=>(!min||rank[c.dataset.sev]<=rank[min])&&(!asp||c.dataset.aspect===asp)&&(!repo||c.dataset.repo===repo)&&(!q||words(c).includes(q));
const mark=(d,hit)=>{if(hit){if(!d.open&&d.dataset.shut!==q){d.open=true;d.dataset.found=""}}else if("found"in d.dataset){d.open=false;delete d.dataset.found}};
for(const c of cards){const v=ok(c);c.classList.toggle("off",!v);if(v)shown.add(c.id)}
for(const c of questions){const v=ok(c);c.classList.toggle("off",!v);if(v)asked++}
for(const c of[...cards,...questions]){const on=!!q&&!c.classList.contains("off");const b=c.querySelector(":scope>.body");
if(b)mark(b,on&&[...b.children].some(x=>x.tagName!=="SUMMARY"&&x.textContent.toLowerCase().includes(q)));
for(const m of c.querySelectorAll(".more"))mark(m,on&&[...m.querySelectorAll("figure")].some(x=>x.textContent.toLowerCase().includes(q)))}
for(const g of groups)g.classList.toggle("off",active&&![...g.querySelectorAll(".finding")].some(c=>shown.has(c.id)));
f.querySelector("output").textContent=shown.size+" of "+cards.length+" findings"+(questions.length?" and "+asked+" of "+questions.length+(questions.length===1?" question":" questions"):"")+" shown";};
f.addEventListener("input",apply);apply()}
const reveal=id=>{const t=id&&document.getElementById(id);if(!t)return;if(f&&t.closest(".off")){f.reset();apply();t.scrollIntoView()}
const b=t.matches(".finding")&&t.querySelector(":scope>.body");if(b){b.open=true;delete b.dataset.found;delete b.dataset.shut}};
const fromHash=()=>reveal(decodeURIComponent(location.hash.slice(1)));
document.addEventListener("click",ev=>{if(ev.defaultPrevented||ev.button||ev.metaKey||ev.ctrlKey||ev.shiftKey||ev.altKey)return;
const a=ev.target.closest&&ev.target.closest('a[href^="#"]');if(a)reveal(decodeURIComponent(a.getAttribute("href").slice(1)))});
window.addEventListener("hashchange",fromHash);fromHash();label();})();`;

const tile = (figure: string, label: string, cls = "") =>
    `<div class="sum${cls ? ` ${cls}` : ""}"><b${figure === "not estimated" ? ' class="na"' : ""}>${e(figure)}</b><span>${e(label)}</span></div>`;

/**
 * The summary's effort: tiles of the findings counted by size, or of their hours totalled per list
 * when the export includes them; then, whenever a card shows a size, a question's too, the sizes'
 * legend, and with hours how a size alone counts in the totals.
 */
function effortBlock(fixFirst: ReportFinding[], canWait: ReportFinding[], questions: ReportFinding[], hours: boolean): string {
    const all = [...fixFirst, ...canWait];
    const unsized = all.filter(f => !f.effort && !f.effortHours);
    const parts: string[] = [];
    if (all.length && unsized.length === all.length) parts.push(`<p class="muted">Not estimated: no finding has a size.</p>`);
    else if (all.length && !hours) {
        const counts = SIZES.map(s => [all.filter(f => f.effort === s.size).length, `sized ${s.size}`] as const).filter(([n]) => n);
        const shown = [...counts, ...(unsized.length ? [[unsized.length, "not sized"] as const] : [])];
        parts.push(
            `<div class="sums">${shown.map(([n, label]) => tile(String(n), label, label === "not sized" ? "zero" : "")).join("")}</div>`
        );
    } else if (all.length) {
        const groups = (
            [
                ["Fix before sign-off", fixFirst],
                ["Can wait", canWait]
            ] as const
        )
            .filter(([, list]) => list.length)
            .map(([what, list]) => {
                const total = totalHours(list);
                return { what, total, sized: list.length > total.unsized };
            });
        const sums = groups.map(g => tile(g.sized ? formatTotal(g.total) : "not estimated", g.what));
        if (groups.filter(g => g.sized).length > 1) sums.push(tile(formatTotal(totalHours(all)), "In all", "all"));
        parts.push(`<div class="sums">${sums.join("")}</div>`);
        if (unsized.length)
            parts.push(`<p class="muted">Not sized, so left out of the totals: ${e(listed(unsized.map(f => f.label)))}.</p>`);
    }
    if ([...all, ...questions].some(f => f.effort)) {
        parts.push(`<ul class="sizes">${SIZES.map(s => `<li><b>${s.size}</b> ${e(s.span)}</li>`).join("")}</ul>`);
        if (hours && totalHours(all).bySize)
            parts.push(`<p class="muted note">Findings without hours count at the range of their size: ${e(BY_SIZE_TEXT.join(", "))}.</p>`);
    }
    return parts.length ? `<div class="effort"><h3>Estimated effort</h3>\n${parts.join("\n")}\n</div>` : "";
}

/** The model calls' cost: billed dollars and the plan's API-equivalent ones never added together. */
function costLine(cost: ReportData["cost"]): string {
    if (!cost) return "";
    const usd = (x: number) => `$${x.toFixed(2)}`;
    const atLeast = cost.unpriced ? "at least " : "";
    const unknown = cost.unpriced
        ? `; ${cost.unpriced} ${cost.unpriced === 1 ? "call was" : "calls were"} served by a model with no price row, so ${cost.unpriced === 1 ? "its" : "their"} cost is unknown`
        : "";
    if (cost.planUsd && cost.apiKeyUsd)
        return `<li>Cost of the model calls: ${atLeast}${usd(cost.apiKeyUsd)} through the API key, plus ${usd(cost.planUsd)} API-equivalent on the Claude plan, which bills nothing for them${unknown}.</li>`;
    if (cost.planUsd)
        return `<li>API-equivalent cost of the model calls: ${atLeast}${usd(cost.planUsd)}; the Claude plan bills nothing for them${unknown}.</li>`;
    return `<li>Cost of the model calls: ${atLeast}${usd(cost.apiKeyUsd)}${unknown}.</li>`;
}

const unreviewed = (f: ReportFinding) => (f.unreviewed ? ` <span class="pill unreviewed">not reviewed</span>` : "");

/** A draft says on its cover how much of it the auditor has not reviewed yet. */
function draftLine(d: ReportData, findings: ReportFinding[]): string {
    if (!d.draft) return "";
    const n = findings.filter(f => f.unreviewed).length;
    const q = d.questions.filter(f => f.unreviewed).length;
    const parts = [
        ...(n ? [`${n} of ${plural(findings.length, "finding", "findings")}`] : []),
        ...(q ? [`${q} of ${plural(d.questions.length, "open question", "open questions")}`] : [])
    ];
    return `<p class="draft">A draft for a first look: ${parts.join(" and ")} ${n + q === 1 ? "is" : "are"} not yet reviewed by the auditor, each marked “not reviewed”.</p>`;
}

const RECHECK_PILL: Record<string, string> = {
    regressed: ` <span class="pill regressed">regressed since the last audit</span>`,
    changed: ` <span class="pill limited">code changed since the last audit</span>`
};

function finding(f: ReportFinding, manyRepos: boolean): string {
    const byDefault = f.severity === "critical" || f.severity === "high";
    const call =
        f.severity !== null && f.fixBeforeSignoff != null && f.fixBeforeSignoff !== byDefault
            ? f.fixBeforeSignoff
                ? "agreed to fix before sign-off"
                : "agreed to fix after sign-off"
            : null;
    const meta = [manyRepos ? f.repository : null, f.aspect, f.checklistItem, effortText(f), call].filter(Boolean).join(" · ");
    const link = (r: Ref) => (r.url ? out(r.url, e(r.label)) : e(r.label));
    const R = f.refs;
    const refs = R
        ? [
              (R.top10 || R.asvs.length || R.wcag.length) &&
                  `Relevant to: ${[R.top10, ...R.asvs, ...R.wcag]
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
    return `<article id="${e(f.label)}" class="finding sev-${e(severityOf(f))}" data-sev="${e(severityOf(f))}" data-aspect="${e(f.aspect)}" data-repo="${e(f.repository)}" aria-labelledby="${e(f.label)}-title">
<div class="head">
<p class="title" id="${e(f.label)}-title">${badge(f)}<span class="fid">${e(f.label)}</span><span>${e(f.title)}</span></p>
<p class="meta">${e(meta)}${RECHECK_PILL[f.recheck ?? ""] ?? ""}${unreviewed(f)}</p>
<div class="callout"><h4>Recommendation</h4><p class="prose">${e(f.recommendation)}</p></div>
</div>
<details class="body"><summary>Details and evidence<span class="vh"> for ${e(f.label)}</span></summary>
<p class="lead">${e(f.summary)}</p>
${pair}
<h4>Details</h4>
<p class="prose">${e(f.explanation)}</p>
${f.evidence.length ? `<h4>Evidence</h4>\n${places(f.evidence)}` : ""}
${refs.length ? `<div class="refs"><h4>References</h4>${refs.map(r => `<p>${r}</p>`).join("")}</div>` : ""}
</details>
</article>`;
}

/** The re-audit's comparison with the findings reported before it (design § 9). */
function since(d: ReportData, findings: ReportFinding[]): string {
    const s = d.since;
    if (!s) return "";
    const item = (f: ReportFinding, linked: boolean) =>
        `<li>${badge(f)}${linked ? `<a class="fid" href="#${e(f.label)}">${e(f.label)}</a>` : `<span class="fid">${e(f.label)}</span>`}<span>${e(f.title)}</span></li>`;
    const regressed = findings.filter(f => f.recheck === "regressed");
    const counts = [
        `${s.fixed.length} fixed`,
        `${s.unchanged} with code unchanged`,
        ...(s.open ? [`${s.open} confirmed open`] : []),
        ...(s.regressed ? [`${s.regressed} regressed`] : []),
        `${s.added} new`
    ];
    return `<section id="since"><h2>Since the last audit</h2>
<p>Re-audited at ${s.commits.map(c => `${e(shortSha(c.sha))} (${e(c.repository)})`).join(", ")}.</p>
<p>${counts.join(" · ")}.</p>
${s.changed.length ? `<p>Code changed since, not yet verified: ${s.changed.map(e).join(", ")}.</p>` : ""}
<h3>Fixed</h3>
${s.fixed.length ? `<ul class="risks">${s.fixed.map(f => item(f, false)).join("")}</ul>` : `<p class="muted">None of the findings reported before is fixed yet.</p>`}
${regressed.length ? `<h3>Regressed</h3><ul class="risks">${regressed.map(f => item(f, true)).join("")}</ul>` : ""}
</section>`;
}

export function renderReport(d: ReportData): string {
    const number = (f: ReportFinding) => Number(f.label.replace(/\D/g, ""));
    const findings = [...d.findings].sort((a, b) => compareFindings({ ...a, number: number(a) }, { ...b, number: number(b) }));
    const count = (s: string) => findings.filter(f => f.severity === s).length;
    // Andrii's call per finding wins; otherwise critical and high come before sign-off (design § 10).
    const before = (f: ReportFinding) => f.fixBeforeSignoff ?? (f.severity === "critical" || f.severity === "high");
    const fixFirst = findings.filter(before);
    const canWait = findings.filter(f => !before(f));
    // The cover names a single repository; a line repeating it only wraps.
    const manyRepos = d.repositories.length > 1;
    const card = (f: ReportFinding) => finding(f, manyRepos);
    const aside = (f: ReportFinding) => [manyRepos ? f.repository : null, f.aspect, effortText(f)].filter(Boolean).join(" · ");
    const riskList = (list: ReportFinding[], none: string) =>
        list.length
            ? `<ul class="risks">${list.map(f => `<li>${badge(f)}<a class="fid" href="#${e(f.label)}">${e(f.label)}</a><span>${e(f.title)}${unreviewed(f)}</span><span class="aside">${e(aside(f))}</span></li>`).join("")}</ul>`
            : `<p class="muted">${e(none)}</p>`;
    const effort = effortBlock(fixFirst, canWait, d.questions, d.hours);
    const titleList = (list: ReportFinding[]) =>
        list.length
            ? `<ul>${list.map(f => `<li>${badge(f)}<a class="fid" href="#${e(f.label)}">${e(f.label)}</a><span>${e(f.title)}${unreviewed(f)}</span></li>`).join("")}</ul>`
            : "";
    // With several repositories the findings run per repository, in the cover's order (design § 10).
    const names = [...new Set([...d.repositories.map(r => r.name), ...findings.map(f => f.repository)])];
    const ids = new Map<string, string>();
    for (const n of names) {
        const base = `repo-${n.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
        let id = base;
        for (let i = 2; [...ids.values()].includes(id); i++) id = `${base}-${i}`;
        ids.set(n, id);
    }
    const seamsLegend = d.seamsPaths?.length
        ? `<p class="muted">Each path starts with its repository: ${d.seamsPaths.map(p => `<code>${e(p.path)}/</code> is ${e(p.repository)}`).join(", ")}.</p>\n`
        : "";
    // A repository with nothing accepted keeps its heading, or a reader might take it for unaudited.
    const groups = manyRepos ? names.map(n => ({ name: n, list: findings.filter(f => f.repository === n) })) : [];
    const option = (v: string, label = v) => `<option value="${e(v)}">${e(label)}</option>`;
    const filters = `<form class="filters" onsubmit="return false">
<label>Severity <select name="sev">${option("", "All")}${option("critical", "Critical")}${option("high", "High and above")}${option("medium", "Medium and above")}${option("low", "Low and above")}</select></label>
<label>Aspect <select name="aspect">${option("", "All")}${[...new Set(findings.map(f => f.aspect))].map(a => option(a)).join("")}</select></label>
${manyRepos ? `<label>Repository <select name="repo">${option("", "All")}${names.map(n => option(n)).join("")}</select></label>` : ""}
<label>Search <input name="q" type="search" placeholder="Words in a finding"></label>
<button type="button" class="all">Expand all</button>
<output></output>
</form>`;
    const repoHead = (n: string) => `<h3 class="repo" id="${e(ids.get(n)!)}">${e(n)}</h3>`;

    const tiles = SEVERITIES.map(s => `<div class="tile ${s}${count(s) ? "" : " zero"}"><b>${count(s)}</b><span>${s}</span></div>`).join(
        ""
    );
    const link = (href: string | null | undefined, html: string) => (href ? out(href, html) : html);
    const repos = d.repositories
        .map(
            r =>
                `<li>${link(r.links?.repo, e(r.name))} <span class="muted">· ${link(r.links?.branch, e(r.branch))} ·</span> ${link(r.links?.commit, `<code>${e(r.sha.slice(0, 10))}</code>`)}</li>`
        )
        .join("");
    const auditor = d.auditor ? link(d.auditorUrl, e(d.auditor)) : "";
    const limited = (a: ReportData["aspects"][number]) => a.status === "done" && limitedReview(a.coverage);
    const aspects = d.aspects.length
        ? `<h3>Coverage</h3>\n<ul class="coverage">${d.aspects
              .map(a => {
                  const examined = a.coverage.filter(c => c.status === "examined").length;
                  const gaps = a.coverage.filter(c => c.status !== "examined");
                  return `<li><b>${e(a.title)}</b>${a.coverage.length ? `: ${examined} of ${plural(a.coverage.length, "item", "items")} examined.` : ""} <span class="pill ${e(a.status)}">${e(a.status)}</span>${
                      limited(a) ? ` <span class="pill limited">limited review</span>` : ""
                  }
${UNFINISHED[a.status] ? `<p>${UNFINISHED[a.status]}</p>` : ""}
${limited(a) ? `<p>The agent looked at fewer than half of its checklist; the items it did not examine are listed below.</p>` : ""}
${gaps.length ? `<ul class="gaps">${gaps.map(c => `<li><span class="fid">${e(c.item)}</span> ${e(c.title)} <span class="pill ${e(c.status)}">${e(COVERAGE[c.status] ?? c.status)}</span></li>`).join("")}</ul>` : ""}</li>`;
              })
              .join("\n")}</ul>`
        : "";
    const tools = d.toolVersions
        ? `<li>Scanners: ${e(
              Object.values(d.toolVersions.images)
                  .map(i => i.digest || i.image)
                  .join(", ")
          )}. Semgrep rulesets: ${e(d.toolVersions.rulesets.map(r => `${r.name} (${r.rules} rules, sha256 ${r.sha256.slice(0, 12)})`).join(", "))}. OSV queried ${e(
              d.toolVersions.osvQueriedAt.slice(0, 10)
          )}.</li>`
        : "";
    const aiBuilt = d.aiBuilt ? [...findings, ...d.questions].filter(f => f.tags?.includes("ai-built")) : [];
    const aiSection = aiBuilt.length
        ? `<section id="ai-built"><h2>Signs of AI-generated code</h2>
<p class="muted">Findings typical of code written largely by AI tools: uneven checks, packages to verify, copies that drifted apart. Each is described in full under Findings.</p>
${titleList(aiBuilt)}</section>`
        : "";
    const questions = d.questions.length
        ? `<section id="questions"><h2>Open questions</h2>
<p class="muted">Points the code alone could not settle; each needs an answer from the team.</p>
${d.questions.map(card).join("\n")}</section>`
        : "";

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(`${d.draft ? "Draft code audit" : "Code audit"}: ${d.projectName}`)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="doc">
<header class="cover">
<div class="eyebrow">${d.draft ? "Draft code audit" : "Code audit"}</div>
<h1>${e(d.projectName)}</h1>
<p class="lede">${plural(findings.length, "finding", "findings")} and ${plural(d.questions.length, "open question", "open questions")} across ${plural(d.repositories.length, "repository", "repositories")}</p>
${draftLine(d, findings)}
<dl class="facts">
<div><dt>Date</dt><dd>${e(d.generatedAt)}</dd></div>
${auditor ? `<div><dt>Auditor</dt><dd>${auditor}</dd></div>` : ""}
<div class="repos"><dt>Repositories audited (branch, commit)</dt><dd><ul>${repos}</ul></dd></div>
</dl>
<div class="tiles">${tiles}</div>
</header>

<nav class="toc"><h2>Contents</h2><ol>
<li><a href="#summary">Summary</a></li>
${d.since ? `<li><a href="#since">Since the last audit</a></li>` : ""}
<li><a href="#scope">Scope and method</a></li>
<li><a href="#findings">Findings (${findings.length})</a>${
        manyRepos
            ? `<ul>${groups.map(g => `<li><a href="#${e(ids.get(g.name)!)}">${e(g.name)} (${g.list.length})</a></li>`).join("")}</ul>`
            : ""
    }</li>
${aiBuilt.length ? `<li><a href="#ai-built">Signs of AI-generated code (${aiBuilt.length})</a></li>` : ""}
${d.questions.length ? `<li><a href="#questions">Open questions (${d.questions.length})</a></li>` : ""}
<li><a href="#technical">Technical details</a></li>
<li><a href="#disclaimer">Disclaimer</a></li>
</ol></nav>

<section id="summary"><h2>Summary</h2>
<h3>Fix before sign-off</h3>
${riskList(fixFirst, "Nothing needs fixing before sign-off.")}
<h3>Can wait</h3>
${canWait.length ? `<p class="muted">Still to fix, after sign-off.</p>` : ""}
${riskList(canWait, "Nothing else was found.")}
${d.questions.length ? `<p>${d.questions.length === 1 ? "1 open question needs the team's answer." : `${d.questions.length} open questions need the team's answers.`}</p>` : ""}
${effort}
</section>
${since(d, findings)}

<section id="scope"><h2>Scope and method</h2>
${aspects}
<h3>Method</h3>
<ul class="method">
${method(d)}
<li>The client's code was read, not installed, built or run: no dependency install, no type-check, no project lint.</li>
${staticOnly(d)}
<li>Model access: ${d.modelAccess.map(a => ACCESS_TEXT[a]).join("; ") || "none"}.</li>
${d.repositories
    .filter(r => r.notCovered.length)
    .map(
        r =>
            `<li>Not covered in ${e(r.name)}: ${e(r.notCovered.join("; "))}. The audit covers JavaScript and TypeScript; these were not analysed.</li>`
    )
    .join("\n")}
${d.methodUrl ? `<li>More on the method: ${out(d.methodUrl, e(d.methodUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")))}.</li>` : ""}
</ul>
</section>

<section id="findings"><h2>Findings</h2>
${findings.length ? filters : `<p class="muted">No findings were accepted for this report.</p>`}
${
    manyRepos
        ? groups
              .map(
                  g =>
                      `<div class="repo-group">${repoHead(g.name)}\n${g.name === SEAMS_TITLE ? seamsLegend : ""}${g.list.length ? g.list.map(card).join("\n") : `<p class="muted">No findings were accepted for this repository.</p>`}</div>`
              )
              .join("\n")
        : findings.map(card).join("\n")
}
</section>
${aiSection}
${questions}

<section id="technical"><h2>Technical details</h2>
<ul class="tech">
<li>Models that served calls: ${e(d.servedModels.join(", ") || "none")}.</li>
${tools}
<li>Budgets are checked between model calls; a call in progress may exceed its share by its own cost.</li>
${costLine(d.cost)}
</ul>
</section>

<section id="disclaimer"><h2>Disclaimer</h2>
<p class="disclaimer">An audit finds issues; it does not certify their absence. Findings describe the code at the commits listed above.</p>
</section>
<p class="colophon">${auditor ? `${auditor} · ` : ""}${e(d.generatedAt)}</p>
</main>
<script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}

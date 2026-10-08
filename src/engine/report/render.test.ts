import { describe, expect, it } from "vitest";

import { reportData as data, reportFinding as finding } from "@/test/report-data";

import { renderReport } from "./render";

describe("renderReport", () => {
    it("compares a re-audit with the last one: what was fixed, what is unchanged, open, back or new", () => {
        const html = renderReport(
            data({
                findings: [
                    finding({ label: "F-001", severity: "critical", recheck: "regressed" }),
                    finding({ label: "F-004", severity: "low", recheck: "unchanged" }),
                    finding({ label: "F-005", severity: "low", recheck: "changed" })
                ],
                since: {
                    commits: [
                        { repository: "app", sha: "c".repeat(40) },
                        { repository: "Seams between repositories", sha: `${"c".repeat(40)}+${"d".repeat(40)}` }
                    ],
                    fixed: [finding({ label: "F-002", severity: "high", title: "Raw SQL in search" })],
                    unchanged: 1,
                    open: 2,
                    regressed: 1,
                    changed: ["F-005"],
                    added: 2
                }
            })
        );
        expect(html).toContain('<li><a href="#since">Since the last audit</a></li>');
        const since = html.slice(html.indexOf('<section id="since">'), html.indexOf("</section>", html.indexOf('<section id="since">')));
        expect(since).toContain("Re-audited at ccccccc (app), ccccccc+ddddddd (Seams between repositories).");
        expect(since).toContain("1 fixed · 1 with code unchanged · 2 confirmed open · 1 regressed · 2 new.");
        expect(since).toContain("Code changed since, not yet verified: F-005.");
        expect(since).toContain("Raw SQL in search");
        expect(since).toContain('<a class="fid" href="#F-001">F-001</a>');
        // A fixed finding is listed here, not among the findings.
        expect(html).not.toContain('id="F-002"');
        expect(html).toContain('<span class="pill regressed">regressed since the last audit</span>');
        expect(html).toContain('<span class="pill limited">code changed since the last audit</span>');
    });

    it("says when nothing reported before is fixed yet, and has no comparison without a re-audit", () => {
        const html = renderReport(
            data({
                since: {
                    commits: [{ repository: "app", sha: "c".repeat(40) }],
                    fixed: [],
                    unchanged: 0,
                    open: 0,
                    regressed: 0,
                    changed: [],
                    added: 0
                }
            })
        );
        expect(html).toContain("None of the findings reported before is fixed yet.");
        expect(html).not.toContain("not yet verified");
        expect(renderReport(data())).not.toContain('id="since"');
    });

    it("orders findings of one severity by their number", () => {
        const html = renderReport(
            data({ findings: [finding({ label: "F-007", title: "Seventh" }), finding({ label: "F-003", title: "Third" })] })
        );
        expect(html.indexOf('id="F-003"')).toBeLessThan(html.indexOf('id="F-007"'));
    });

    it("anchors every finding by its ID, most severe first", () => {
        const html = renderReport(data());
        expect(html.indexOf('id="F-001"')).toBeGreaterThan(0);
        expect(html.indexOf('id="F-001"')).toBeLessThan(html.indexOf('id="F-002"'));
    });

    it("escapes code in snippets", () => {
        const html = renderReport(data());
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("is one self-contained file: no external script, stylesheet or image", () => {
        expect(renderReport(data())).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet|<img[^>]+src="http/);
    });

    it("names every model that served calls, and what was not run", () => {
        const html = renderReport(data());
        expect(html).toContain("claude-opus-4-8");
        expect(html).toMatch(/not installed, built or run/);
    });

    it("says examined, never passed", () => {
        const html = renderReport(data());
        expect(html).toContain("examined");
        expect(html).not.toMatch(/\bpassed\b/i);
    });

    it("explains a partly covered aspect", () => {
        const html = renderReport(
            data({
                aspects: [{ title: "Security", status: "partial", note: "Partially covered: the budget share was spent.", coverage: [] }]
            })
        );
        expect(html).toContain("the budget share was spent");
    });

    it("says what reading the code alone could not show, for performance and for accessibility apart", () => {
        const aspect = (key: string, title: string) => ({ key, title, status: "done", note: null, coverage: [] });
        const perf = "<li>Performance was judged from the code alone: no page was rendered or timed.</li>";
        const a11y =
            "<li>Accessibility was judged from the code alone: no page was rendered and no screen reader was run; contrast was computed only for colour pairs written in the code.</li>";
        expect(renderReport(data({ aspects: [aspect("security", "Security")] }))).not.toMatch(/judged from the code alone/);
        const one = renderReport(data({ aspects: [aspect("accessibility", "Accessibility (web)")] }));
        expect(one).toContain(a11y);
        expect(one).not.toContain(perf);
        const both = renderReport(
            data({ aspects: [aspect("performance", "Performance (web)"), aspect("accessibility", "Accessibility (web)")] })
        );
        expect(both).toContain(perf);
        expect(both).toContain(a11y);
    });

    it("carries the disclaimer", () => {
        expect(renderReport(data())).toMatch(/does not certify/);
    });

    it("names the model access, and its terms, in Scope and method", () => {
        const html = renderReport({ ...data(), modelAccess: ["claude_plan"] });
        expect(html).toContain("Model access: a Claude subscription through the Claude Agent SDK, under Anthropic's Consumer Terms.");
    });

    // The redesign of 2026-10-06 (plan 2026-10-06-auditdesk-report-redesign.md, R.1).
    const between = (html: string, start: string, end: string) => {
        const from = html.indexOf(start);
        return html.slice(from, html.indexOf(end, from));
    };

    it("opens with a cover naming the project, the auditor and each repository's commit", () => {
        const cover = between(renderReport(data()), '<header class="cover"', "</header>");
        expect(cover).toContain("Acme");
        expect(cover).toContain("Andrii Naidenko");
        expect(cover).toContain("0123456789");
    });

    it("marks an aspect whose agent looked at fewer than half of its items as a limited review", () => {
        const html = renderReport(
            data({
                aspects: [
                    {
                        title: "Security",
                        status: "done",
                        note: null,
                        coverage: [
                            { item: "SEC-01", title: "Authentication", status: "examined" },
                            { item: "SEC-03", title: "Authorization", status: "not_examined" },
                            { item: "SEC-04", title: "Injection", status: "not_examined" }
                        ]
                    }
                ]
            })
        );
        expect(between(html, '<section id="scope"', "</section>")).toMatch(/limited review[^<]*<\/span>/);
        expect(between(html, '<section id="scope"', "</section>")).toContain("fewer than half of its checklist");
        expect(between(renderReport(data()), '<section id="scope"', "</section>")).not.toContain("limited review");
    });

    it("marks a draft on its cover and in its title, and each finding and question not yet reviewed wherever it is listed", () => {
        const html = renderReport(
            data({
                draft: true,
                findings: [
                    finding({ label: "F-001", severity: "critical" }),
                    finding({ label: "F-002", severity: "low", unreviewed: true })
                ],
                questions: [finding({ label: "F-003", severity: null, title: "Backups?", unreviewed: true })]
            })
        );
        expect(html).toContain("<title>Draft code audit: Acme</title>");
        const cover = between(html, '<header class="cover"', "</header>");
        expect(cover).toContain('<div class="eyebrow">Draft code audit</div>');
        expect(cover).toContain(
            '<p class="draft">A draft for a first look: 1 of 2 findings and 1 of 1 open question are not yet reviewed by the auditor, each marked “not reviewed”.</p>'
        );
        const pill = '<span class="pill unreviewed">not reviewed</span>';
        expect(between(html, 'id="F-002"', "</article>")).toContain(pill);
        expect(between(html, 'id="F-003"', "</article>")).toContain(pill);
        expect(between(html, 'id="F-001"', "</article>")).not.toContain(pill);
        expect(between(html, '<section id="summary">', "</section>")).toContain(`Raw SQL ${pill}</span>`);
        expect(renderReport(data())).not.toMatch(/Draft|not reviewed/);
    });

    it("names no auditor when none is set, rather than someone else's name", () => {
        const html = renderReport(data({ auditor: null }));
        expect(between(html, '<header class="cover"', "</header>")).not.toContain("Auditor");
        expect(html).not.toContain("Andrii Naidenko");
        expect(html).toMatch(/<p class="colophon">\d{4}-\d{2}-\d{2}<\/p>/);
    });

    it("links the auditor's name to their page, on the cover and at the end, and only when there is one", () => {
        const link = '<a href="https://naidenko.dev/" target="_blank" rel="noopener noreferrer">Andrii Naidenko</a>';
        const html = renderReport(data({ auditorUrl: "https://naidenko.dev/" }));
        expect(between(html, '<header class="cover"', "</header>")).toContain(link);
        expect(between(html, '<p class="colophon">', "</p>")).toContain(link);
        expect(renderReport(data())).not.toContain(">Andrii Naidenko</a>");
        expect(between(renderReport(data()), '<p class="colophon">', "</p>")).toContain("Andrii Naidenko · ");
    });

    it("links each repository, its branch and its commit when it has a web address, and a local one not at all", () => {
        const sha = "0123456789abcdef0123456789abcdef01234567";
        const html = renderReport(
            data({
                repositories: [
                    {
                        name: "acme/app",
                        branch: "main",
                        sha,
                        notCovered: [],
                        links: {
                            repo: "https://github.com/acme/app",
                            branch: "https://github.com/acme/app/tree/main",
                            commit: `https://github.com/acme/app/commit/${sha}`
                        }
                    },
                    { name: "web", branch: "main", sha: "fedcba9876543210", notCovered: [] }
                ]
            })
        );
        const repos = between(html, '<div class="repos">', "</div>");
        expect(repos).toContain('<a href="https://github.com/acme/app" target="_blank" rel="noopener noreferrer">acme/app</a>');
        expect(repos).toContain('<a href="https://github.com/acme/app/tree/main" target="_blank" rel="noopener noreferrer">main</a>');
        expect(repos).toContain(
            `<a href="https://github.com/acme/app/commit/${sha}" target="_blank" rel="noopener noreferrer"><code>0123456789</code></a>`
        );
        expect(repos).toContain("<li>web <span");
        expect(repos.match(/<a /g)).toHaveLength(3);
    });

    it("opens every link that leaves the report in a new tab, and keeps the in-page links in the report", () => {
        const sha = "0123456789abcdef0123456789abcdef01234567";
        const html = renderReport(
            data({
                auditorUrl: "https://naidenko.dev/",
                methodUrl: "https://naidenko.dev/audit",
                repositories: [
                    {
                        name: "acme/app",
                        branch: "main",
                        sha,
                        notCovered: [],
                        links: {
                            repo: "https://github.com/acme/app",
                            branch: "https://github.com/acme/app/tree/main",
                            commit: `https://github.com/acme/app/commit/${sha}`
                        }
                    }
                ],
                findings: [
                    finding({
                        refs: {
                            top10: null,
                            cwe: { label: "CWE-862", url: "https://cwe.mitre.org/data/definitions/862.html" },
                            asvs: [],
                            cheatsheets: [],
                            advisories: [],
                            nist: null,
                            wcag: []
                        }
                    })
                ]
            })
        );
        const anchors = [...html.matchAll(/<a [^>]*>/g)].map(m => m[0]);
        const outward = anchors.filter(a => !a.startsWith('<a href="#') && !a.startsWith('<a class="fid" href="#'));
        expect(outward).toHaveLength(7);
        for (const a of outward) expect(a).toMatch(/ target="_blank" rel="noopener noreferrer">$/);
        for (const a of anchors.filter(a => !outward.includes(a))) expect(a).not.toContain("target=");
    });

    it("walks through the method: scanners, an agent per aspect, the auditor's review with its tally, then the method in full", () => {
        const html = renderReport(
            data({
                toolVersions: {
                    images: {
                        gitleaks: { image: "g", digest: "g@sha256:1" },
                        osv: { image: "o", digest: "o@sha256:2" },
                        semgrep: { image: "s", digest: "s@sha256:3" }
                    },
                    rulesets: [],
                    osvQueriedAt: "2026-10-07T10:00:00Z"
                },
                review: { filed: 59, reported: 43, fixed: 0, merged: 10, rejected: 5, excluded: 1, unreviewed: 0 },
                methodUrl: "https://naidenko.dev/audit"
            })
        );
        const method = between(html, '<ul class="method">', "</ul>");
        expect(method).toContain("gitleaks over the history of every branch cloned, osv-scanner over the lock files and Semgrep");
        expect(method).toContain("one agent per aspect read the code through read-only tools, against the aspect's checklist");
        expect(method).toContain(
            "The auditor reviewed all 59 findings the scanners and agents filed: 43 are in this report, 10 were merged into others, 5 rejected as wrong and 1 kept out of the report."
        );
        expect(method).toContain('<a href="https://naidenko.dev/audit" target="_blank" rel="noopener noreferrer">naidenko.dev/audit</a>');
        expect(method.indexOf("gitleaks")).toBeLessThan(method.indexOf("one agent per aspect"));
        expect(method.indexOf("one agent per aspect")).toBeLessThan(method.indexOf("The auditor reviewed"));
        expect(method.indexOf("The auditor reviewed")).toBeLessThan(method.indexOf("not installed, built or run"));
    });

    it("words the method for what ran: pinned images, an agent per aspect and repository, fixes found at a re-audit", () => {
        const html = renderReport(
            data({
                toolVersions: {
                    images: {
                        gitleaks: { image: "g", digest: "g@sha256:1" },
                        osv: { image: "o", digest: "o@sha256:2" },
                        semgrep: { image: "s", digest: "s@sha256:3" }
                    },
                    rulesets: [],
                    osvQueriedAt: "2026-10-07T10:00:00Z"
                },
                repositories: [...data().repositories, { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }],
                review: { filed: 10, reported: 6, fixed: 2, merged: 1, rejected: 1, excluded: 0, unreviewed: 0 }
            })
        );
        const method = between(html, '<ul class="method">', "</ul>");
        expect(method).toContain(
            "gitleaks over the history of every branch cloned, osv-scanner over the lock files and Semgrep; their pinned images are under Technical details."
        );
        expect(method).toContain("one agent per aspect and repository read the code");
        expect(method).toContain(
            "6 are in this report, 2 were found fixed at a re-audit, 1 was merged into others and 1 rejected as wrong."
        );
    });

    it("says plainly when no finding is reviewed yet", () => {
        const html = renderReport(
            data({ review: { filed: 12, reported: 0, fixed: 0, merged: 0, rejected: 0, excluded: 0, unreviewed: 12 } })
        );
        expect(between(html, '<ul class="method">', "</ul>")).toContain(
            "None of the 12 findings the scanners and agents filed is reviewed yet."
        );
    });

    it("says how many findings are not reviewed yet, and leaves out the parts it has no data for", () => {
        const partial = renderReport(
            data({ review: { filed: 12, reported: 9, fixed: 0, merged: 0, rejected: 0, excluded: 0, unreviewed: 3 } })
        );
        expect(between(partial, '<ul class="method">', "</ul>")).toContain(
            "The auditor reviewed 9 of the 12 findings the scanners and agents filed: 9 are in this report; 3 not reviewed yet are not."
        );
        const bare = between(renderReport(data({ aspects: [] })), '<ul class="method">', "</ul>");
        expect(bare).not.toMatch(/gitleaks|one agent per aspect|The auditor reviewed|More on the method/);
        expect(bare).toContain("not installed, built or run");
    });

    it("lists the sections in its contents, each with its count, and no finding", () => {
        const html = renderReport(data({ questions: [finding({ label: "F-003", severity: null, title: "Who rotates the key?" })] }));
        const toc = between(html, '<nav class="toc"', "</nav>");
        for (const id of ["summary", "scope", "findings", "questions", "disclaimer"]) {
            expect(toc).toContain(`href="#${id}"`);
            expect(html).toContain(`id="${id}"`);
        }
        expect(toc).toContain('<a href="#findings">Findings (2)</a>');
        expect(toc).toContain('<a href="#questions">Open questions (1)</a>');
        expect(toc).not.toMatch(/F-00\d|Raw SQL|Who rotates/);
    });

    it("prints each finding's title twice: on its Summary line and on its card", () => {
        const html = renderReport(
            data({
                findings: [
                    finding({ label: "F-001", severity: "critical", title: "Admin route open" }),
                    finding({ label: "F-002", severity: "medium", title: "Verbose errors" }),
                    finding({ label: "F-003", severity: "low", title: "Old lodash" })
                ]
            })
        );
        for (const title of ["Admin route open", "Verbose errors", "Old lodash"]) expect(html.split(title).length - 1).toBe(2);
        expect(between(html, '<section id="findings">', "</section>")).not.toContain("<table");
    });

    it("puts each finding's aspect and effort on its Summary line, and its repository when there are several", () => {
        const line = (html: string) => between(between(html, '<section id="summary">', "</section>"), 'href="#F-001"', "</li>");
        const one = renderReport(
            data({ hours: true, findings: [finding({ aspect: "Security", effort: "M", effortHours: { low: 4, high: 6 } })] })
        );
        expect(line(one)).toContain('<span class="aside">Security · effort M (4–6 h)</span>');
        const two = renderReport(
            data({
                repositories: [...data().repositories, { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }],
                findings: [finding({ aspect: "Security", effort: "S" })]
            })
        );
        expect(line(two)).toContain('<span class="aside">app · Security · effort S</span>');
    });

    it("numbers evidence lines from their start line", () => {
        const html = renderReport(
            data({ findings: [finding({ evidence: [{ file: "a.ts", startLine: 41, endLine: 42, snippet: "one\ntwo" }] })] })
        );
        expect(html).toMatch(/<span class="ln">41<\/span>one/);
        expect(html).toMatch(/<span class="ln">42<\/span>two/);
    });

    it("prints on A4", () => {
        const html = renderReport(data({ questions: [finding({ label: "F-003", severity: null })] }));
        expect(html).toMatch(/@page\s*\{[^}]*size:\s*A4/);
    });

    it("shows a card's head and Recommendation, and keeps the rest in a body closed on screen", () => {
        const html = renderReport(data({ findings: [finding({ recommendation: "Use parameterised queries.", summary: "One line." })] }));
        const card = between(html, 'id="F-001"', "</article>");
        const [head, body] = card.split('<details class="body">');
        expect(head).toContain('<p class="title" id="F-001-title">');
        expect(head).toContain('<p class="meta">security · SEC-04 · effort S</p>');
        expect(head).toContain("Use parameterised queries.");
        expect(html.split("Use parameterised queries.").length - 1).toBe(1);
        expect(body).toMatch(
            /^<summary>Details and evidence<span class="vh"> for F-001<\/span><\/summary>\n<p class="lead">One line\.<\/p>/
        );
        expect(body).toContain("<h4>Details</h4>");
        expect(body).toContain("<h4>Evidence</h4>");
        expect(body).toContain("<h4>References</h4>");
        expect(html.match(/<details[^>]* open/g)).toBeNull();
    });

    it("gives an open question the same card", () => {
        const html = renderReport(data({ questions: [finding({ label: "F-009", severity: null })] }));
        expect(between(html, '<section id="questions">', "</section>")).toMatch(
            /<article id="F-009" class="finding sev-question"[^>]*>\n<div class="head">[\s\S]*<details class="body">/
        );
    });

    // On the naidenko.dev report (E.9) a card's title sat alone at the foot of a page.
    it("lets a card run onto the next page, keeping its title, meta line and Recommendation together", () => {
        const print = between(renderReport(data()), "@media print{", "</style>");
        expect(print).not.toMatch(/\.finding\{[^}]*break-inside:avoid/);
        expect(print).toContain(".finding .title,.finding .meta{break-after:avoid}");
        expect(print).toContain(".finding .title,.finding .lead,.pair,.callout,figure{break-inside:avoid}");
    });

    it("sums up an aspect whose agent examined every item in one line", () => {
        const covered = ["SEC-01", "SEC-03", "SEC-04"].map(item => ({ item, title: item, status: "examined" }));
        const scope = between(
            renderReport(data({ aspects: [{ title: "Security", status: "done", note: null, coverage: covered }] })),
            '<section id="scope"',
            "</section>"
        );
        expect(scope).toContain("<b>Security</b>: 3 of 3 items examined.");
        expect(scope).not.toContain("<table");
        expect(scope).not.toContain('class="gaps"');
    });

    it("names each item not fully examined, with its status", () => {
        const coverage = [
            { item: "SEC-01", title: "Authentication", status: "examined" },
            { item: "SEC-03", title: "Authorization", status: "partly" },
            { item: "SEC-04", title: "Injection", status: "not_examined" },
            { item: "SEC-05", title: "XSS", status: "not_reported" }
        ];
        const scope = between(
            renderReport(data({ aspects: [{ title: "Security", status: "done", note: null, coverage }] })),
            '<section id="scope"',
            "</section>"
        );
        expect(scope).toContain("<b>Security</b>: 1 of 4 items examined.");
        const gaps = between(scope, '<ul class="gaps">', "</ul>");
        expect(gaps).toContain('<span class="fid">SEC-03</span> Authorization <span class="pill partly">partly examined</span>');
        expect(gaps).toContain('<span class="pill not_examined">not examined</span>');
        expect(gaps).toContain("not reported (the agent stopped first)");
        expect(gaps).not.toContain("SEC-01");
    });

    it("keeps scanner digests and ruleset hashes out of the method, in Technical details before the Disclaimer", () => {
        const html = renderReport(
            data({
                toolVersions: {
                    images: {
                        gitleaks: { image: "ghcr.io/gitleaks/gitleaks:v8.30.1", digest: "sha256:aaa" },
                        osv: { image: "ghcr.io/google/osv-scanner:v2.6.0", digest: "sha256:bbb" },
                        semgrep: { image: "semgrep/semgrep:1.179.0", digest: "sha256:ccc" }
                    },
                    rulesets: [{ name: "p-javascript", sha256: "d".repeat(64), rules: 10 }],
                    osvQueriedAt: "2026-10-07T10:00:00Z"
                },
                cost: { apiKeyUsd: 1, planUsd: 0, unpriced: 0 }
            })
        );
        const method = between(html, '<ul class="method">', "</ul>");
        expect(method).not.toMatch(/sha256|Models that served|Budgets are checked|Cost of the model calls/);
        expect(method).toContain("Model access:");
        const tech = between(html, '<section id="technical">', "</section>");
        for (const s of [
            "sha256:aaa",
            "sha256 dddddddddddd",
            "OSV queried 2026-10-07",
            "Models that served calls",
            "Budgets are checked",
            "Cost of the model calls"
        ])
            expect(tech).toContain(s);
        expect(html.indexOf('<section id="technical">')).toBeLessThan(html.indexOf('<section id="disclaimer">'));
        expect(between(html, '<nav class="toc"', "</nav>")).toContain('<a href="#technical">Technical details</a>');
    });

    it("lists ten places on a card and the rest under 'and N more places'", () => {
        const evidence = Array.from({ length: 13 }, (_, i) => ({ file: `src/f${i}.ts`, startLine: 1, endLine: 1, snippet: `k${i}` }));
        const html = renderReport(data({ findings: [finding({ evidence })] }));
        const from = html.indexOf('id="F-001"');
        const card = html.slice(from, html.indexOf("</article>", from));
        const [shown, more] = card.split('<details class="more">');
        expect(shown.split("<figure>").length - 1).toBe(10);
        expect(more.split("<figure>").length - 1).toBe(3);
        expect(more).toContain('<summary>and 3 more places<span class="print-only"> in the HTML report</span></summary>');
    });

    it("names a one-line range as one line", () => {
        const html = renderReport(
            data({ findings: [finding({ evidence: [{ file: "pnpm-lock.yaml", startLine: 9, endLine: 9, snippet: "x" }] })] })
        );
        expect(html).toContain("pnpm-lock.yaml · line 9<");
        expect(html).not.toContain("lines 9–9");
    });

    it("gives Impact the full width when there is no Likelihood", () => {
        const html = renderReport(data({ findings: [finding({ likelihood: null, impact: "All users' data." })] }));
        expect(html).toMatch(/<div class="pair one"><div><h4>Impact<\/h4>/);
        expect(html).toMatch(/\.pair\.one\{grid-template-columns:1fr\}/);
    });

    it("gives each repository its own run of findings, in the cover's order, and lists them so in the contents", () => {
        const html = renderReport(
            data({
                repositories: [
                    { name: "web", branch: "main", sha: "0123456789abcdef", notCovered: [] },
                    { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }
                ],
                findings: [
                    finding({ label: "F-001", severity: "critical", repository: "api", title: "Open admin route" }),
                    finding({ label: "F-002", severity: "low", repository: "web", title: "Verbose errors" })
                ]
            })
        );
        const body = html.slice(html.indexOf('<section id="findings">'));
        expect(body.indexOf('<h3 class="repo" id="repo-web">web</h3>')).toBeGreaterThan(0);
        expect(body.indexOf('id="F-002"')).toBeLessThan(body.indexOf('<h3 class="repo" id="repo-api">api</h3>'));
        expect(body.indexOf('<h3 class="repo" id="repo-api">api</h3>')).toBeLessThan(body.indexOf('id="F-001"'));
        const toc = between(html, '<nav class="toc">', "</nav>");
        expect(toc.indexOf('<a href="#repo-web">web (1)</a>')).toBeLessThan(toc.indexOf('<a href="#repo-api">api (1)</a>'));
        expect(toc).not.toContain("F-00");
    });

    it("gives the seams between repositories their own run of findings after the repositories'", () => {
        const html = renderReport(
            data({
                repositories: [
                    { name: "web", branch: "main", sha: "0123456789abcdef", notCovered: [] },
                    { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }
                ],
                findings: [
                    finding({
                        label: "F-001",
                        severity: "critical",
                        repository: "Seams between repositories",
                        title: "Admin route open to anyone"
                    }),
                    finding({ label: "F-002", severity: "low", repository: "api", title: "Verbose errors" })
                ]
            })
        );
        const body = html.slice(html.indexOf('<section id="findings">'));
        const heading = '<h3 class="repo" id="repo-Seams-between-repositories">Seams between repositories</h3>';
        expect(body.indexOf('id="F-002"')).toBeLessThan(body.indexOf(heading));
        expect(body.indexOf(heading)).toBeLessThan(body.indexOf('id="F-001"'));
        expect(between(html, '<nav class="toc">', "</nav>")).toContain(
            '<a href="#repo-Seams-between-repositories">Seams between repositories (1)</a>'
        );
        expect(html).toContain('<option value="Seams between repositories">');
    });

    it("says which repository each path of a seams finding starts with", () => {
        const html = renderReport(
            data({
                repositories: [
                    { name: "acme/web", branch: "main", sha: "0123456789abcdef", notCovered: [] },
                    { name: "partner/web", branch: "main", sha: "fedcba9876543210", notCovered: [] }
                ],
                findings: [finding({ label: "F-001", repository: "Seams between repositories" })],
                seamsPaths: [
                    { path: "web-main", repository: "acme/web" },
                    { path: "web-2", repository: "partner/web" }
                ]
            })
        );
        const seams = html.slice(html.indexOf('id="repo-Seams-between-repositories"'));
        expect(seams).toContain(
            '<p class="muted">Each path starts with its repository: <code>web-main/</code> is acme/web, <code>web-2/</code> is partner/web.</p>'
        );
        expect(seams.indexOf("Each path starts")).toBeLessThan(seams.indexOf('id="F-001"'));
    });

    it("adds no repository headings for a single repository", () => {
        expect(renderReport(data())).not.toContain('class="repo"');
    });

    it("links a finding's references as relevant to standards, never as compliance with them", () => {
        const html = renderReport(
            data({
                findings: [
                    finding({
                        refs: {
                            top10: {
                                label: "A01:2025 Broken Access Control",
                                url: "https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/"
                            },
                            cwe: { label: "CWE-862", url: "https://cwe.mitre.org/data/definitions/862.html" },
                            asvs: [
                                {
                                    label: "ASVS 5.0.0 V8.3 Operation Level Authorization",
                                    url: "https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md"
                                }
                            ],
                            cheatsheets: [
                                {
                                    label: "Authorization Cheat Sheet",
                                    url: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html"
                                }
                            ],
                            advisories: [],
                            nist: null,
                            wcag: []
                        }
                    })
                ]
            })
        );
        const card = between(html, 'id="F-001"', "</article>");
        expect(card).toMatch(
            /Relevant to: <a href="https:\/\/owasp\.org\/Top10\/2025\/A01_2025-Broken_Access_Control\/" target="_blank" rel="noopener noreferrer">A01:2025 Broken Access Control<\/a>/
        );
        expect(card).toContain(
            '<a href="https://cwe.mitre.org/data/definitions/862.html" target="_blank" rel="noopener noreferrer">CWE-862</a>'
        );
        expect(card).toContain("Authorization Cheat Sheet</a>");
        expect(html).not.toMatch(/complian/i);
    });

    it("lists an accessibility finding's WCAG criteria among the standards it is relevant to", () => {
        const html = renderReport(
            data({
                findings: [
                    finding({
                        aspect: "accessibility",
                        checklistItem: "ACC-01",
                        refs: {
                            top10: null,
                            cwe: null,
                            asvs: [],
                            cheatsheets: [],
                            advisories: [],
                            nist: null,
                            wcag: [
                                {
                                    label: "WCAG 2.2 SC 1.1.1 Non-text Content (Level A)",
                                    url: "https://www.w3.org/TR/WCAG22/#non-text-content"
                                },
                                {
                                    label: "WCAG 2.2 SC 4.1.2 Name, Role, Value (Level A)",
                                    url: "https://www.w3.org/TR/WCAG22/#name-role-value"
                                }
                            ]
                        }
                    })
                ]
            })
        );
        expect(between(html, 'id="F-001"', "</article>")).toContain(
            'Relevant to: <a href="https://www.w3.org/TR/WCAG22/#non-text-content" target="_blank" rel="noopener noreferrer">WCAG 2.2 SC 1.1.1 Non-text Content (Level A)</a>; <a href="https://www.w3.org/TR/WCAG22/#name-role-value" target="_blank" rel="noopener noreferrer">WCAG 2.2 SC 4.1.2 Name, Role, Value (Level A)</a>.'
        );
    });

    describe("the summary", () => {
        const summary = (html: string) => between(html, '<section id="summary">', "</section>");
        const listed = (html: string, heading: string) => {
            const part = summary(html).split(`<h3>${heading}`)[1] ?? "";
            return [...part.split("<h3>")[0].matchAll(/href="#(F-\d{3})"/g)].map(m => m[1]);
        };

        it("leaves the counts by severity to the cover's tiles", () => {
            const html = renderReport(data({ findings: [finding({ severity: "high" })] }));
            expect(summary(html)).not.toContain("· 0 low");
            expect(between(html, '<header class="cover"', "</header>")).toContain(
                '<div class="tile low zero"><b>0</b><span>low</span></div>'
            );
        });

        it("puts critical and high findings before sign-off by default, and the rest under can wait", () => {
            const html = renderReport(
                data({
                    findings: [
                        finding({ label: "F-001", severity: "critical" }),
                        finding({ label: "F-002", severity: "high" }),
                        finding({ label: "F-003", severity: "medium" }),
                        finding({ label: "F-004", severity: "low" })
                    ]
                })
            );
            expect(listed(html, "Fix before sign-off")).toEqual(["F-001", "F-002"]);
            expect(listed(html, "Can wait")).toEqual(["F-003", "F-004"]);
        });

        it("follows Andrii's override over the default", () => {
            const html = renderReport(
                data({
                    findings: [
                        finding({ label: "F-001", severity: "high", fixBeforeSignoff: false }),
                        finding({ label: "F-002", severity: "low", fixBeforeSignoff: true })
                    ]
                })
            );
            expect(listed(html, "Fix before sign-off")).toEqual(["F-002"]);
            expect(listed(html, "Can wait")).toEqual(["F-001"]);
        });

        it("counts the findings by size when the export leaves the hours out, with a legend of the sizes", () => {
            const html = renderReport(
                data({
                    findings: [
                        finding({ label: "F-001", effort: "S" }),
                        finding({ label: "F-002", effort: "S" }),
                        finding({ label: "F-003", effort: "M" }),
                        finding({ label: "F-004", effort: "L" }),
                        finding({ label: "F-005", effort: null })
                    ]
                })
            );
            expect(summary(html)).toContain("Estimated effort: 2 findings sized S, 1 sized M, 1 sized L and 1 not sized.");
            expect(summary(html)).toContain("Sizes: S up to 2 hours, M up to 2 days, L over 2 days.");
            expect(summary(html)).not.toMatch(/\d h\b/);
        });

        it("totals the hours to fix before sign-off and after it as ranges, a finding without hours at its size's", () => {
            const html = renderReport(
                data({
                    hours: true,
                    findings: [
                        finding({ label: "F-001", severity: "critical", effort: "S", effortHours: { low: 1, high: 2 } }),
                        finding({ label: "F-002", severity: "high", effort: "M", effortHours: { low: 4, high: 8 } }),
                        finding({ label: "F-003", severity: "low", effort: "S" }),
                        finding({ label: "F-004", severity: "low", effort: "M", effortHours: { low: 3, high: 6 } })
                    ]
                })
            );
            expect(summary(html)).toContain("Estimated effort: 5–10 h to fix before sign-off and 4–8 h for what can wait, 9–18 h in all.");
            expect(summary(html)).toContain(
                "Sizes: S up to 2 hours, M up to 2 days, L over 2 days. Findings without hours count at the range of their size: S at 1–2 h, M at 2–16 h, L at 16 h or more."
            );
        });

        it("leaves a total open when a large finding has no hours, and names the findings not sized", () => {
            const html = renderReport(
                data({
                    hours: true,
                    findings: [
                        finding({ label: "F-001", severity: "critical", effort: "L" }),
                        finding({ label: "F-002", severity: "high", effort: null }),
                        finding({ label: "F-003", severity: "low", effort: "S", effortHours: { low: 1, high: 2 } })
                    ]
                })
            );
            expect(summary(html)).toContain(
                "Estimated effort: 16 h or more to fix before sign-off and 1–2 h for what can wait, 17 h or more in all. Not sized, so left out of the totals: F-002."
            );
        });

        it("says a list has no estimate when none of its findings is sized", () => {
            const html = renderReport(
                data({
                    hours: true,
                    findings: [
                        finding({ label: "F-001", severity: "critical", effort: null }),
                        finding({ label: "F-002", severity: "low", effort: "M", effortHours: { low: 4, high: 8 } })
                    ]
                })
            );
            expect(summary(html)).toContain(
                "Estimated effort: no estimate to fix before sign-off and 4–8 h for what can wait. Not sized, so left out of the totals: F-001."
            );
        });

        it("gives the legend whenever a card shows a size, a question's included", () => {
            const question = finding({ label: "F-003", severity: null, effort: "S" });
            const legend = "Sizes: S up to 2 hours, M up to 2 days, L over 2 days.";
            expect(summary(renderReport(data({ findings: [], questions: [question] })))).toContain(legend);
            const unsized = summary(renderReport(data({ findings: [finding({ effort: null })], questions: [question] })));
            expect(unsized).toContain("Effort: not estimated.");
            expect(unsized).toContain(legend);
            expect(summary(renderReport(data({ findings: [finding({ effort: null })] })))).not.toContain("Sizes:");
        });
    });

    it("filters by severity, aspect and repository, and searches, from inline script only", () => {
        const html = renderReport(
            data({
                repositories: [
                    { name: "web", branch: "main", sha: "0123456789abcdef", notCovered: [] },
                    { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }
                ],
                findings: [finding({ label: "F-001", repository: "web", aspect: "Security" })]
            })
        );
        const filters = between(html, '<form class="filters"', "</form>");
        expect(filters).toContain('name="sev"');
        expect(filters).toContain('<option value="Security">Security</option>');
        expect(filters).toContain('<option value="api">api</option>');
        expect(filters).toContain('name="q"');
        expect(filters).toContain('<button type="button" class="all">Expand all</button>');
        expect(html).toMatch(
            /<article id="F-001" class="finding sev-high" data-sev="high" data-aspect="Security" data-repo="web" aria-labelledby="F-001-title">/
        );
        expect(html).toMatch(/<script>[\s\S]*?querySelector[\s\S]*?<\/script>/);
        expect(html).not.toMatch(/<script[^>]+src=/);
        expect(between(html, "@media print{", "</style>")).toMatch(/\.filters\{display:none/);
    });

    describe("the summary's edge cases", () => {
        const summary = (html: string) => between(html, '<section id="summary">', "</section>");
        it("says the effort is not estimated when nothing is sized", () => {
            expect(summary(renderReport(data({ findings: [finding({ effort: null })] })))).toContain("Effort: not estimated.");
        });
        it("writes hours whose ends agree as one number, on the card and in the total", () => {
            const html = renderReport(data({ hours: true, findings: [finding({ effort: "S", effortHours: { low: 2, high: 2 } })] }));
            expect(summary(html)).toContain("Estimated effort: 2 h to fix before sign-off.");
            expect(between(html, 'id="F-001"', "</article>")).toContain("effort S (2 h)");
        });
        it("says the findings that can wait still need fixing, and shows Andrii's call on the card", () => {
            const html = renderReport(data({ findings: [finding({ label: "F-001", severity: "critical", fixBeforeSignoff: false })] }));
            expect(summary(html)).toContain("Still to fix, after sign-off.");
            expect(between(html, 'id="F-001"', "</article>")).toContain("agreed to fix after sign-off");
        });
        it("counts the open questions the team must answer", () => {
            expect(summary(renderReport(data({ questions: [finding({ label: "F-009", severity: null })] })))).toContain(
                "1 open question needs the team's answer."
            );
        });
    });

    it("shows a reference it cannot link as plain text", () => {
        const html = renderReport(
            data({
                findings: [
                    finding({
                        refs: {
                            top10: null,
                            cwe: { label: "SQL injection", url: null },
                            asvs: [],
                            cheatsheets: [],
                            advisories: [],
                            nist: null,
                            wcag: []
                        }
                    })
                ]
            })
        );
        expect(html).toContain("Weakness: SQL injection.");
    });

    it("hides filtered findings on screen only, so a printout is always complete", () => {
        const html = renderReport(data());
        expect(html).toMatch(/@media screen\{\.off\{display:none!important\}\}/);
        expect(html).not.toMatch(/\[hidden\]\{display:none/);
        expect(html).toMatch(/classList\.toggle\("off"/);
    });

    it("groups each repository's findings so a filter can hide an emptied heading", () => {
        const html = renderReport(
            data({
                repositories: [
                    { name: "web", branch: "main", sha: "0123456789abcdef", notCovered: [] },
                    { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }
                ],
                findings: [finding({ label: "F-001", repository: "web" })]
            })
        );
        expect(html).toMatch(/<div class="repo-group"><h3 class="repo" id="repo-web">web<\/h3>/);
        expect(html).toMatch(/hashchange/);
    });

    it("states the model calls' cost only when the export asks for it", () => {
        expect(renderReport(data({ cost: null }))).not.toMatch(/cost of the model calls/i);
        expect(renderReport(data({ cost: { apiKeyUsd: 1.234, planUsd: 0, unpriced: 0 } }))).toContain(
            "<li>Cost of the model calls: $1.23.</li>"
        );
        expect(renderReport(data({ cost: { apiKeyUsd: 0, planUsd: 1.234, unpriced: 0 } }))).toContain(
            "<li>API-equivalent cost of the model calls: $1.23; the Claude plan bills nothing for them.</li>"
        );
    });

    it("keeps plan dollars apart from billed ones, and says when some calls could not be priced", () => {
        expect(renderReport(data({ cost: { apiKeyUsd: 1.2, planUsd: 3, unpriced: 0 } }))).toContain(
            "<li>Cost of the model calls: $1.20 through the API key, plus $3.00 API-equivalent on the Claude plan, which bills nothing for them.</li>"
        );
        expect(renderReport(data({ cost: { apiKeyUsd: 1.2, planUsd: 0, unpriced: 2 } }))).toContain(
            "<li>Cost of the model calls: at least $1.20; 2 calls were served by a model with no price row, so their cost is unknown.</li>"
        );
    });

    it("gathers the findings tagged ai-built under Signs of AI-generated code", () => {
        const html = renderReport(
            data({
                aiBuilt: true,
                findings: [
                    finding({ label: "F-001", title: "Raw SQL" }),
                    finding({ label: "F-002", title: "Admin action unchecked", tags: ["ai-built"] })
                ]
            })
        );
        const section = between(html, '<section id="ai-built">', "</section>");
        expect(section).toContain("Signs of AI-generated code");
        expect(section).toContain('href="#F-002"');
        expect(section).not.toContain('href="#F-001"');
        expect(between(html, '<nav class="toc">', "</nav>")).toContain('<a href="#ai-built">Signs of AI-generated code (1)</a>');
    });

    it("gathers tagged questions under Signs of AI-generated code too", () => {
        const html = renderReport(data({ aiBuilt: true, questions: [finding({ label: "F-009", severity: null, tags: ["ai-built"] })] }));
        expect(between(html, '<section id="ai-built">', "</section>")).toContain('href="#F-009"');
    });

    it("filters and searches the open questions too", () => {
        const html = renderReport(data({ questions: [finding({ label: "F-009", severity: null })] }));
        expect(html).toMatch(/section#questions \.finding/);
    });

    it("leaves the AI-generated code section out when the mode is off", () => {
        const html = renderReport(data({ aiBuilt: false, findings: [finding({ tags: ["ai-built"] })] }));
        expect(html).not.toContain('id="ai-built"');
    });

    it("names what a repository's audit did not cover, in Scope and method", () => {
        const html = renderReport(
            data({
                repositories: [
                    { name: "app", branch: "main", sha: "0123456789abcdef", notCovered: ["Python (14 files; api/requirements.txt)"] }
                ]
            })
        );
        expect(between(html, '<section id="scope">', "</section>")).toContain(
            "Not covered in app: Python (14 files; api/requirements.txt)."
        );
    });

    it("gives a repository without accepted findings its heading, and says so", () => {
        const html = renderReport(
            data({
                repositories: [
                    { name: "web", branch: "main", sha: "0123456789abcdef", notCovered: [] },
                    { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }
                ],
                findings: [finding({ label: "F-001", repository: "web" })]
            })
        );
        const body = html.slice(html.indexOf('<section id="findings">'));
        expect(body).toContain('<h3 class="repo" id="repo-api">api</h3>');
        expect(body).toContain("No findings were accepted for this repository.");
    });

    it("keeps repository anchors unique when names differ only in punctuation", () => {
        const html = renderReport(
            data({
                repositories: ["a b", "a-b-3", "a-b"].map((name, i) => ({ name, branch: "main", sha: `${i}`.repeat(16), notCovered: [] })),
                findings: ["a b", "a-b-3", "a-b"].map((repository, i) => finding({ label: `F-00${i + 1}`, repository }))
            })
        );
        const ids = [...html.matchAll(/<h3 class="repo" id="([^"]+)"/g)].map(m => m[1]);
        expect(new Set(ids).size).toBe(3);
    });

    it("has no AI-generated code section when no finding carries the tag", () => {
        expect(renderReport(data())).not.toContain('id="ai-built"');
    });
});

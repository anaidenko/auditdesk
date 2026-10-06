import { describe, expect, it } from "vitest";

import { reportData as data, reportFinding as finding } from "@/test/report-data";

import { renderReport } from "./render";

describe("renderReport", () => {
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

    it("lists every section and every finding ID in its contents", () => {
        const html = renderReport(data({ questions: [finding({ label: "F-003", severity: null, title: "Who rotates the key?" })] }));
        const toc = between(html, '<nav class="toc"', "</nav>");
        for (const id of ["summary", "scope", "findings", "questions", "disclaimer", "F-001", "F-002", "F-003"])
            expect(toc).toContain(`href="#${id}"`);
        for (const id of ["summary", "scope", "findings", "questions", "disclaimer"]) expect(html).toContain(`id="${id}"`);
    });

    it("numbers evidence lines from their start line", () => {
        const html = renderReport(
            data({ findings: [finding({ evidence: [{ file: "a.ts", startLine: 41, endLine: 42, snippet: "one\ntwo" }] })] })
        );
        expect(html).toMatch(/<span class="ln">41<\/span>one/);
        expect(html).toMatch(/<span class="ln">42<\/span>two/);
    });

    it("prints on A4, with every finding open", () => {
        const html = renderReport(data({ questions: [finding({ label: "F-003", severity: null })] }));
        expect(html).toMatch(/@page\s*\{[^}]*size:\s*A4/);
        expect(html).toContain("<details");
        expect(html.match(/<details(?! open)/g)).toBeNull();
    });

    // Chromium ignores break-after:avoid between a <summary> and the rest of its <details>: on the
    // naidenko.dev report (E.9) a card's title sat alone at the foot of a page.
    it("starts a finding on a new page rather than leave its title alone at the foot of one", () => {
        const print = between(renderReport(data()), "@media print{", "</style>");
        expect(print).toMatch(/\.finding\{[^}]*break-inside:avoid/);
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
        expect(body.indexOf('open id="F-002"')).toBeLessThan(body.indexOf('<h3 class="repo" id="repo-api">api</h3>'));
        expect(body.indexOf('<h3 class="repo" id="repo-api">api</h3>')).toBeLessThan(body.indexOf('open id="F-001"'));
        const toc = between(html, '<nav class="toc">', "</nav>");
        expect(toc.indexOf("F-002")).toBeLessThan(toc.indexOf("F-001"));
        expect(toc).toContain('<a href="#repo-api">api</a>');
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
                            nist: null
                        }
                    })
                ]
            })
        );
        const card = between(html, 'id="F-001"', "</details>");
        expect(card).toMatch(
            /Relevant to: <a href="https:\/\/owasp\.org\/Top10\/2025\/A01_2025-Broken_Access_Control\/">A01:2025 Broken Access Control<\/a>/
        );
        expect(card).toContain('<a href="https://cwe.mitre.org/data/definitions/862.html">CWE-862</a>');
        expect(card).toContain("Authorization Cheat Sheet</a>");
        expect(html).not.toMatch(/complian/i);
    });

    describe("the summary", () => {
        const summary = (html: string) => between(html, '<section id="summary">', "</section>");
        const listed = (html: string, heading: string) => {
            const part = summary(html).split(`<h3>${heading}`)[1] ?? "";
            return [...part.split("<h3>")[0].matchAll(/href="#(F-\d{3})"/g)].map(m => m[1]);
        };

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

        it("adds up the hours Andrii set and counts the rest by size", () => {
            const html = renderReport(
                data({
                    findings: [
                        finding({ label: "F-001", effort: "S", effortHours: 3 }),
                        finding({ label: "F-002", effort: "M", effortHours: 10 }),
                        finding({ label: "F-003", effort: "M" }),
                        finding({ label: "F-004", effort: "L" }),
                        finding({ label: "F-005", effort: null })
                    ]
                })
            );
            expect(summary(html)).toContain(
                "Estimated effort: 13 h for the 2 findings the auditor estimated, plus 1 medium (under 2 days), 1 large (more) and 1 not sized."
            );
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
        expect(html).toMatch(/<details open id="F-001" class="finding sev-high" data-sev="high" data-aspect="Security" data-repo="web">/);
        expect(html).toMatch(/<script>[\s\S]*?querySelector[\s\S]*?<\/script>/);
        expect(html).not.toMatch(/<script[^>]+src=/);
        expect(between(html, "@media print{", "</style>")).toMatch(/\.filters\{display:none/);
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
        expect(between(html, '<nav class="toc">', "</nav>")).toContain('<a href="#ai-built">Signs of AI-generated code</a>');
    });

    it("gathers tagged questions under Signs of AI-generated code too", () => {
        const html = renderReport(data({ aiBuilt: true, questions: [finding({ label: "F-009", severity: null, tags: ["ai-built"] })] }));
        expect(between(html, '<section id="ai-built">', "</section>")).toContain('href="#F-009"');
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

    // The cover names a single repository; a column repeating it wrapped in the PDF (R.3).
    it("shows the repository column only when the audit spans more than one repository", () => {
        const head = (html: string) => between(html, "<thead>", "</thead>");
        const one = renderReport(data());
        expect(head(one.slice(one.indexOf('id="findings"')))).not.toContain("Repository");
        const two = renderReport(
            data({ repositories: [...data().repositories, { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }] })
        );
        expect(head(two.slice(two.indexOf('id="findings"')))).toContain("Repository");
    });
});

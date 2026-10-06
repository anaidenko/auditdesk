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
                    { name: "web", branch: "main", sha: "0123456789abcdef" },
                    { name: "api", branch: "main", sha: "fedcba9876543210" }
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
        expect(toc.indexOf("F-002")).toBeLessThan(toc.indexOf("F-001"));
        expect(toc).toContain('<a href="#repo-api">api</a>');
    });

    it("adds no repository headings for a single repository", () => {
        expect(renderReport(data())).not.toContain('class="repo"');
    });

    // The cover names a single repository; a column repeating it wrapped in the PDF (R.3).
    it("shows the repository column only when the audit spans more than one repository", () => {
        const head = (html: string) => between(html, "<thead>", "</thead>");
        const one = renderReport(data());
        expect(head(one.slice(one.indexOf('id="findings"')))).not.toContain("Repository");
        const two = renderReport(
            data({ repositories: [...data().repositories, { name: "api", branch: "main", sha: "fedcba9876543210" }] })
        );
        expect(head(two.slice(two.indexOf('id="findings"')))).toContain("Repository");
    });
});

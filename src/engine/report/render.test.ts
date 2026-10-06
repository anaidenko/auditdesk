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
});

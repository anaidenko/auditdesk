import { describe, expect, it } from "vitest";

import { renderReport } from "./render";
import type { ReportData, ReportFinding } from "./types";

const finding = (over: Partial<ReportFinding>): ReportFinding => ({
    label: "F-001",
    severity: "high",
    aspect: "security",
    checklistItem: "SEC-04",
    title: "Raw SQL",
    likelihood: "l",
    impact: "i",
    summary: "s",
    explanation: "e",
    recommendation: "r",
    effort: "S",
    effortHours: null,
    evidence: [{ file: "a.ts", startLine: 1, endLine: 2, snippet: 'q("<script>alert(1)</script>")' }],
    references: { cwe: "CWE-89" },
    repository: "app",
    ...over
});

const data = (over: Partial<ReportData> = {}): ReportData => ({
    projectName: "Acme",
    generatedAt: "2026-10-20",
    auditor: "Andrii Naidenko",
    repositories: [{ name: "app", branch: "main", sha: "0123456789abcdef" }],
    aspects: [{ title: "Security", status: "done", note: null, coverage: [{ item: "SEC-04", title: "Injection", status: "examined" }] }],
    servedModels: ["claude-opus-5-5", "claude-opus-4-8"],
    modelAccess: ["api_key"],
    toolVersions: null,
    findings: [finding({ label: "F-002", severity: "low" }), finding({ label: "F-001", severity: "critical" })],
    questions: [],
    costUsd: null,
    ...over
});

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
});

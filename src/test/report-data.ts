import type { ReportData, ReportFinding } from "@/engine/report/types";

/** A report's data for the renderer's and the PDF's tests. */
export const reportFinding = (over: Partial<ReportFinding>): ReportFinding => ({
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

export const reportData = (over: Partial<ReportData> = {}): ReportData => ({
    projectName: "Acme",
    generatedAt: "2026-10-20",
    auditor: "Andrii Naidenko",
    repositories: [{ name: "app", branch: "main", sha: "0123456789abcdef", notCovered: [] }],
    aspects: [{ title: "Security", status: "done", note: null, coverage: [{ item: "SEC-04", title: "Injection", status: "examined" }] }],
    servedModels: ["claude-opus-5-5", "claude-opus-4-8"],
    modelAccess: ["api_key"],
    toolVersions: null,
    findings: [reportFinding({ label: "F-002", severity: "low" }), reportFinding({ label: "F-001", severity: "critical" })],
    questions: [],
    costUsd: null,
    aiBuilt: false,
    ...over
});

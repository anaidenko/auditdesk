import type { ToolVersions } from "../scanners/types";
import type { Evidence, ModelAccess, References, SeverityName } from "../types";

export interface ReportFinding {
    label: string;
    severity: SeverityName | null;
    aspect: string;
    checklistItem: string | null;
    title: string;
    likelihood: string | null;
    impact: string | null;
    summary: string;
    explanation: string;
    recommendation: string;
    effort: string | null;
    effortHours: number | null;
    evidence: Evidence[];
    references: References;
    repository: string;
}

export interface ReportData {
    projectName: string;
    generatedAt: string;
    auditor: string;
    repositories: { name: string; branch: string; sha: string }[];
    aspects: { title: string; status: string; note: string | null; coverage: { item: string; title: string; status: string }[] }[];
    servedModels: string[];
    /** The accesses of the runs whose calls are in the report: which terms the client's code went under. */
    modelAccess: ModelAccess[];
    toolVersions: ToolVersions | null;
    findings: ReportFinding[];
    questions: ReportFinding[];
    costUsd: number | null;
}

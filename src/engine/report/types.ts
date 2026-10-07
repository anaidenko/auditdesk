import type { FindingReferences } from "../references";
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
    tags?: string[];
    /** Andrii's call; null follows the severity (critical and high before sign-off). */
    fixBeforeSignoff?: boolean | null;
    /** Resolved from references/ (design § 10); absent in data built without them. */
    refs?: FindingReferences;
}

export interface ReportData {
    projectName: string;
    generatedAt: string;
    /** AUDITOR_NAME; null leaves the name off the report. */
    auditor: string | null;
    /** Names are unique within a report; `notCovered` lists languages the audit could not analyse. */
    repositories: { name: string; branch: string; sha: string; notCovered: string[] }[];
    aspects: { title: string; status: string; note: string | null; coverage: { item: string; title: string; status: string }[] }[];
    servedModels: string[];
    /** The accesses of the runs whose calls are in the report: which terms the client's code went under. */
    modelAccess: ModelAccess[];
    toolVersions: ToolVersions | null;
    findings: ReportFinding[];
    questions: ReportFinding[];
    /** Only when Andrii ticks it at export (design § 8): billed dollars and plan dollars apart. */
    cost: { apiKeyUsd: number; planUsd: number; unpriced: number } | null;
    /** The project's AI-built mode: the report gathers ai-built findings only when it is on (design § 10). */
    aiBuilt: boolean;
}

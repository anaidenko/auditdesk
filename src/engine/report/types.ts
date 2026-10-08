import type { FindingReferences } from "../references";
import type { ToolVersions } from "../scanners/types";
import type { Evidence, Hours, ModelAccess, References, SeverityName } from "../types";

import type { RepoLinks } from "./links";

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
    /** Null unless the export includes the hours. */
    effortHours: Hours | null;
    evidence: Evidence[];
    references: References;
    repository: string;
    tags?: string[];
    /** Andrii's call; null follows the severity (critical and high before sign-off). */
    fixBeforeSignoff?: boolean | null;
    /** Resolved from references/ (design § 10); absent in data built without them. */
    refs?: FindingReferences;
    /** What the latest re-audit found of it (design § 9). */
    recheck?: "unchanged" | "open" | "fixed" | "changed" | "regressed" | null;
    /** In a draft only: the auditor has not reviewed it yet, and the report says so on its card. */
    unreviewed?: boolean;
}

export interface ReportData {
    projectName: string;
    generatedAt: string;
    /** AUDITOR_NAME; null leaves the name off the report. */
    auditor: string | null;
    /** AUDITOR_URL: the auditor's name links to it. */
    auditorUrl?: string | null;
    /** AUDIT_METHOD_URL: the method in full, linked from Scope and method. */
    methodUrl?: string | null;
    /**
     * Names are unique within a report; `notCovered` lists languages the audit could not analyse;
     * `links` only for a repository cloned from a known web host.
     */
    repositories: { name: string; branch: string; sha: string; notCovered: string[]; links?: RepoLinks }[];
    /** The findings filed (questions and superseded ones apart), by what the review made of them. */
    review?: { filed: number; reported: number; fixed: number; merged: number; rejected: number; excluded: number; unreviewed: number };
    /** The name a seams finding's path starts with, per repository; present when there are seams findings. */
    seamsPaths?: { path: string; repository: string }[];
    aspects: {
        /** The catalogue key; the title names the repository too. */
        key?: string;
        title: string;
        status: string;
        note: string | null;
        coverage: { item: string; title: string; status: string }[];
    }[];
    servedModels: string[];
    /** The accesses of the runs whose calls are in the report: which terms the client's code went under. */
    modelAccess: ModelAccess[];
    toolVersions: ToolVersions | null;
    findings: ReportFinding[];
    questions: ReportFinding[];
    /** Ticked at export, and something awaits review: the findings and questions include it, marked. */
    draft?: boolean;
    /** Andrii ticked the hours at export: the cards carry them and the summary totals them. */
    hours: boolean;
    /** Only when Andrii ticks it at export (design § 8): billed dollars and plan dollars apart. */
    cost: { apiKeyUsd: number; planUsd: number; unpriced: number } | null;
    /** The project's AI-built mode: the report gathers ai-built findings only when it is on (design § 10). */
    aiBuilt: boolean;
    /** Every catalogue item's title, for an item filed under an aspect that did not run (a scanner's DEP-01). */
    itemTitles?: Record<string, string>;
    /**
     * The latest re-audit against the findings reported before it (design § 9); absent when none
     * ran. Fixed findings are listed here and left out of `findings`.
     */
    since?: {
        /** The commit each repository was re-checked at. */
        commits: { repository: string; sha: string }[];
        /** Found fixed at this re-audit; fixes from before it are no news. */
        fixed: ReportFinding[];
        /** Code unchanged: the re-audit's own reading, not a verdict. */
        unchanged: number;
        /** Confirmed still open by the auditor. */
        open: number;
        regressed: number;
        /** Labels whose cited code changed and the auditor has not yet verified: still in `findings`. */
        changed: string[];
        /** Reported findings the re-audit's run filed. */
        added: number;
    } | null;
}

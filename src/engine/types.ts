export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type SeverityName = (typeof SEVERITIES)[number];

export interface Evidence {
    file: string;
    startLine: number;
    endLine: number;
    snippet?: string;
}

export interface References {
    cwe?: string;
    owaspTop10?: string;
    asvs?: string;
    advisories?: string[];
    cheatSheets?: string[];
}

export interface NewFinding {
    repositoryId: string;
    agentRunId: string | null;
    aspect: string;
    kind: "finding" | "question";
    checklistItem: string | null;
    title: string;
    severity: SeverityName | null;
    likelihood: string | null;
    impact: string | null;
    summary: string;
    explanation: string;
    recommendation: string;
    effort: "S" | "M" | "L" | null;
    evidence: Evidence[];
    references: References;
    tags: string[];
    source: "scanner" | "agent";
    fingerprint: string;
}

export interface TokenUsage {
    input: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
    cacheRead: number;
    output: number;
}

export interface CallRecord {
    agentRunId: string | null;
    requestedModel: string;
    servedModel: string;
    fallback: boolean;
    usage: TokenUsage;
    costUsd: number | null;
    stopReason: string | null;
    refusalCategory: string | null;
}

export interface Spend {
    usd: number;
    freshTokens: number;
    unpriced: boolean;
}

/** Everything the engine writes goes through a sink: Prisma in the app, memory in `pnpm eval`. */
export interface AuditSink {
    progress(message: string, level?: "info" | "warn" | "error"): Promise<void>;
    recordCall(call: CallRecord): Promise<void>;
    agentSpend(agentRunId: string): Promise<Spend>;
    runSpend(): Promise<Spend>;
    /** Files the finding and returns its label, such as "F-012". */
    createFinding(finding: NewFinding): Promise<string>;
    /** Index lines of the repository's live findings (not rejected, merged or superseded). */
    findingIndex(repositoryId: string, filter?: { aspect?: string; source?: "scanner" | "agent" }): Promise<string[]>;
    knownFingerprints(repositoryId: string): Promise<Set<string>>;
    stopRequested(): Promise<boolean>;
}

/** How a run reaches Claude: the Agent SDK on the auditor's plan, or the Messages API on a key. */
export type ModelAccess = "claude_plan" | "api_key";

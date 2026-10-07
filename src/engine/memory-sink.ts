import { freshTokens } from "./budget";
import { findingLabel, indexLine, scannerDuplicates } from "./findings";
import { type AuditSink, type CallRecord, type NewFinding, SEVERITIES, type SeverityName, type Spend } from "./types";

/** The sink `pnpm eval` and the engine's tests use: everything in memory. */
export class MemorySink implements AuditSink {
    readonly calls: CallRecord[] = [];
    /** `mergedInto`: a scanner finding folded into an agent's (pipeline, after each agent). */
    readonly findings: (NewFinding & { label: string; mergedInto?: string })[] = [];
    readonly events: string[] = [];
    stop = false;

    async progress(message: string) {
        this.events.push(message);
    }
    async recordCall(call: CallRecord) {
        this.calls.push(call);
    }
    private spend(calls: CallRecord[]): Spend {
        return {
            usd: calls.reduce((s, c) => s + (c.costUsd ?? 0), 0),
            freshTokens: calls.reduce((s, c) => s + freshTokens(c.usage), 0),
            unpriced: calls.some(c => c.costUsd === null)
        };
    }
    async agentSpend(agentRunId: string) {
        return this.spend(this.calls.filter(c => c.agentRunId === agentRunId));
    }
    async runSpend() {
        return this.spend(this.calls);
    }
    async createFinding(f: NewFinding) {
        const label = findingLabel(this.findings.length + 1);
        this.findings.push({ ...f, label });
        return label;
    }
    async findingIndex(repositoryId: string, filter: { aspect?: string; source?: "scanner" | "agent" } = {}) {
        return this.findings
            .filter(
                f =>
                    !f.mergedInto &&
                    f.repositoryId === repositoryId &&
                    (!filter.aspect || f.aspect === filter.aspect) &&
                    (!filter.source || f.source === filter.source)
            )
            .map(indexLine);
    }
    /**
     * As the app's sink folds, but the agent's finding keeps its own evidence: the eval grades each
     * finding by what it cited (evals/run.ts).
     */
    async foldScannerDuplicates(repositoryId: string, agentRunId: string) {
        const placed = (f: (typeof this.findings)[number]) => ({ ...f, cwe: f.references.cwe ?? null });
        const agent = this.findings.filter(f => f.agentRunId === agentRunId).map(placed);
        const scanner = this.findings.filter(f => f.repositoryId === repositoryId && f.source === "scanner" && !f.mergedInto).map(placed);
        const rank = (v: SeverityName | null) => (v ? SEVERITIES.indexOf(v) : SEVERITIES.length);
        return scannerDuplicates(agent, scanner).map(({ from, into }) => {
            const source = this.findings.find(f => f.label === from)!;
            const target = this.findings.find(f => f.label === into)!;
            source.mergedInto = into;
            const raised = rank(source.severity) < rank(target.severity) ? source.severity! : undefined;
            if (raised) target.severity = raised;
            return { from, into, ...(raised ? { raised } : {}) };
        });
    }
    async knownFingerprints(repositoryId: string) {
        return new Set(this.findings.filter(f => f.repositoryId === repositoryId).map(f => f.fingerprint));
    }
    async stopRequested() {
        return this.stop;
    }
}

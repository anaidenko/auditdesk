import { freshTokens } from "./budget";
import { findingLabel, indexLine } from "./findings";
import type { AuditSink, CallRecord, NewFinding, Spend } from "./types";

/** The sink `pnpm eval` and the engine's tests use: everything in memory. */
export class MemorySink implements AuditSink {
    readonly calls: CallRecord[] = [];
    readonly findings: (NewFinding & { label: string })[] = [];
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
                    f.repositoryId === repositoryId &&
                    (!filter.aspect || f.aspect === filter.aspect) &&
                    (!filter.source || f.source === filter.source)
            )
            .map(indexLine);
    }
    async knownFingerprints(repositoryId: string) {
        return new Set(this.findings.filter(f => f.repositoryId === repositoryId).map(f => f.fingerprint));
    }
    async stopRequested() {
        return this.stop;
    }
}

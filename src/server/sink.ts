import "server-only";

import type { AgentOutcome } from "@/engine/agent/run-aspect";
import { freshTokens } from "@/engine/budget";
import { cites, findingLabel, indexLine, scannerDuplicates } from "@/engine/findings";
import type { PipelineSink } from "@/engine/pipeline";
import type { EarlierFinding, RecheckResult } from "@/engine/recheck";
import type { ToolVersions } from "@/engine/scanners/types";
import { shortSha } from "@/engine/short-sha";
import type { StackProfile } from "@/engine/stack";
import {
    type CallRecord,
    type Evidence,
    type IndexFilter,
    type NewFinding,
    type References,
    SEVERITIES,
    type SeverityName,
    type Spend
} from "@/engine/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { createFinding } from "@/server/findings";
import { RUN_CHANNEL } from "@/server/pg";
import { REPORTABLE, ReviewedMeanwhileError, merge } from "@/server/review";

// Rejected findings stay in the agent's index, marked, so a re-run does not file them again (design § 9).
const INDEXED = ["unreviewed", "accepted", "edited", "excluded", "rejected"] as const;

/** Writes the run's state and wakes the SSE listeners in the same transaction (design § 5). */
export class PrismaSink implements PipelineSink {
    constructor(
        readonly runId: string,
        readonly projectId: string
    ) {}

    private notify() {
        return prisma.$executeRaw`SELECT pg_notify(${RUN_CHANNEL}, ${this.runId})`;
    }

    async progress(message: string, level: "info" | "warn" | "error" = "info") {
        await prisma.$transaction([prisma.runEvent.create({ data: { runId: this.runId, message, level } }), this.notify()]);
    }

    async recordCall(c: CallRecord) {
        await prisma.$transaction([
            prisma.apiCall.create({
                data: {
                    runId: this.runId,
                    agentRunId: c.agentRunId,
                    requestedModel: c.requestedModel,
                    servedModel: c.servedModel,
                    fallback: c.fallback,
                    inputTokens: c.usage.input,
                    cacheWrite5mTokens: c.usage.cacheWrite5m,
                    cacheWrite1hTokens: c.usage.cacheWrite1h,
                    cacheReadTokens: c.usage.cacheRead,
                    outputTokens: c.usage.output,
                    costUsd: c.costUsd,
                    stopReason: c.stopReason,
                    refusalCategory: c.refusalCategory
                }
            }),
            this.notify()
        ]);
    }

    private async spendWhere(where: { runId: string; agentRunId?: string }): Promise<Spend> {
        const calls = await prisma.apiCall.findMany({ where });
        return {
            usd: calls.reduce((s, c) => s + Number(c.costUsd ?? 0), 0),
            freshTokens: calls.reduce(
                (s, c) =>
                    s +
                    freshTokens({
                        input: c.inputTokens,
                        cacheWrite5m: c.cacheWrite5mTokens,
                        cacheWrite1h: c.cacheWrite1hTokens,
                        cacheRead: c.cacheReadTokens,
                        output: c.outputTokens
                    }),
                0
            ),
            unpriced: calls.some(c => c.costUsd === null)
        };
    }

    agentSpend(agentRunId: string) {
        return this.spendWhere({ runId: this.runId, agentRunId });
    }

    runSpend() {
        return this.spendWhere({ runId: this.runId });
    }

    async createFinding(f: NewFinding) {
        const { label } = await createFinding(this.projectId, this.runId, f);
        await this.notify();
        return label;
    }

    async findingIndex(repositoryId: string | null, filter: IndexFilter = {}) {
        const found = await prisma.finding.findMany({
            where: {
                projectId: this.projectId,
                repositoryId,
                status: { in: [...INDEXED] },
                ...(filter.aspect && { aspect: filter.aspect }),
                ...(filter.source && { source: filter.source })
            },
            orderBy: { number: "asc" }
        });
        const rows = filter.cites ? found.filter(r => cites(r.evidence as never, filter.cites!)) : found;
        return rows.map(r => {
            const line = indexLine({
                label: findingLabel(r.number),
                severity: r.severity as SeverityName | null,
                checklistItem: r.checklistItem,
                evidence: r.evidence as never,
                title: r.title
            });
            if (r.status === "rejected") return `${line} (rejected by the auditor: ${r.statusReason}; do not report it again)`;
            // Fixed at a re-audit: the same problem in other code is a new finding, not a duplicate.
            if (r.recheck === "fixed") return `${line} (fixed at ${shortSha(r.recheckedSha ?? "")}; file it again if it is back)`;
            return line;
        });
    }

    async foldScannerDuplicates(repositoryId: string, agentRunId: string) {
        const placed = (r: {
            number: number;
            source: string;
            kind: string;
            checklistItem: string | null;
            evidence: unknown;
            references: unknown;
        }) => ({
            label: findingLabel(r.number),
            source: r.source as "agent" | "scanner",
            kind: r.kind as "finding" | "question",
            checklistItem: r.checklistItem,
            evidence: r.evidence as Evidence[],
            cwe: (r.references as { cwe?: string } | null)?.cwe ?? null
        });
        const agent = await prisma.finding.findMany({ where: { agentRunId, status: "unreviewed" }, orderBy: { number: "asc" } });
        // This run's scanner findings only: an earlier run's lines may belong to another commit.
        const scanner = await prisma.finding.findMany({
            where: { repositoryId, runId: this.runId, source: "scanner", status: "unreviewed" },
            orderBy: { number: "asc" }
        });
        const byLabel = new Map([...agent, ...scanner].map(r => [findingLabel(r.number), r]));
        const folded: { from: string; into: string; raised?: SeverityName }[] = [];
        for (const { from, into } of scannerDuplicates(agent.map(placed), scanner.map(placed))) {
            const s = byLabel.get(from)!;
            const target = await prisma.finding.findUniqueOrThrow({ where: { id: byLabel.get(into)!.id } });
            try {
                await merge(s.id, into, { onlyUnreviewed: true });
            } catch (e) {
                if (e instanceof ReviewedMeanwhileError) continue;
                throw e;
            }
            // A folded critical secret must not leave the report with no critical.
            const rank = (v: string | null) => (v ? SEVERITIES.indexOf(v as SeverityName) : SEVERITIES.length);
            const raised = rank(s.severity) < rank(target.severity) ? (s.severity as SeverityName) : undefined;
            if (raised) await prisma.finding.updateMany({ where: { id: target.id, status: "unreviewed" }, data: { severity: raised } });
            folded.push({ from, into, ...(raised ? { raised } : {}) });
        }
        if (folded.length) await this.notify();
        return folded;
    }

    async earlierFindings(repositoryId: string | null, sha: string): Promise<EarlierFinding[]> {
        const rows = await prisma.finding.findMany({
            where: {
                projectId: this.projectId,
                repositoryId,
                kind: "finding",
                status: { in: [...REPORTABLE] },
                AND: [
                    { OR: [{ runId: null }, { runId: { not: this.runId } }] },
                    { OR: [{ recheckedSha: null }, { recheckedSha: { not: sha } }] }
                ]
            },
            include: { run: { select: { commits: true } } },
            orderBy: { number: "asc" }
        });
        // A finding filed at this very commit has nothing to re-check; a seams finding's commit is every
        // repository's, joined in the project's order as the pipeline joins them (JSONB keeps no key order).
        const order = repositoryId
            ? [repositoryId]
            : (await prisma.repository.findMany({ where: { projectId: this.projectId }, orderBy: { createdAt: "asc" } })).map(r => r.id);
        const commitOf = (commits: Record<string, string> | null) =>
            order
                .map(id => commits?.[id])
                .filter(Boolean)
                .join("+");
        return rows
            .filter(r => commitOf(r.run?.commits as Record<string, string> | null) !== sha)
            .map(r => ({
                id: r.id,
                label: findingLabel(r.number),
                source: r.source,
                fingerprint: r.fingerprint,
                title: r.title,
                checklistItem: r.checklistItem,
                references: r.references as References,
                evidence: r.evidence as unknown as Evidence[],
                recheck: r.recheck,
                recheckDigest: r.recheckDigest,
                recheckGone: r.recheckGone
            }));
    }

    async recheckFindings(results: RecheckResult[], sha: string) {
        const at = new Date();
        await prisma.$transaction(
            results.map(r =>
                prisma.finding.update({
                    where: { id: r.id },
                    data: {
                        recheckDigest: r.digest,
                        recheckGone: r.gone,
                        // A finding that stays fixed keeps the commit it was found fixed at: "since the last audit" is news only.
                        ...(r.keep ? {} : { recheck: r.status, recheckedSha: sha, recheckedAt: at, recheckRunId: this.runId }),
                        ...(r.evidence ? { evidence: r.evidence as unknown as Prisma.InputJsonArray } : {})
                    }
                })
            )
        );
        await this.notify();
    }

    async knownFingerprints(repositoryId: string) {
        const rows = await prisma.finding.findMany({ where: { repositoryId }, select: { fingerprint: true, evidence: true } });
        // A grouped scanner finding's places are known one by one: the next run files only new ones.
        return new Set(rows.flatMap(r => [r.fingerprint, ...(r.evidence as unknown as Evidence[]).flatMap(e => (e.key ? [e.key] : []))]));
    }

    async stopRequested() {
        return (await prisma.run.findUniqueOrThrow({ where: { id: this.runId }, select: { stopRequested: true } })).stopRequested;
    }

    async stackDetected(repositoryId: string, profile: StackProfile) {
        await prisma.repository.update({
            where: { id: repositoryId },
            data: { stack: profile as unknown as Prisma.InputJsonObject, stackDetectedAt: new Date() }
        });
    }

    async repositoryCloned(repositoryId: string, sha: string, clonePath: string, branch: string) {
        await prisma.$transaction([
            prisma.repository.update({ where: { id: repositoryId }, data: { commitSha: sha, clonePath, commitBranch: branch } }),
            prisma.$executeRaw`UPDATE "Run" SET commits = COALESCE(commits, '{}'::jsonb) || jsonb_build_object(${repositoryId}::text, ${sha}::text) WHERE id = ${this.runId}`
        ]);
    }

    async toolVersions(v: ToolVersions) {
        await prisma.run.update({ where: { id: this.runId }, data: { toolVersions: v as object } });
    }

    async startAgent(repositoryId: string, aspect: string, share: { usd: number; tokens: number }) {
        const a = await prisma.agentRun.create({
            data: { runId: this.runId, repositoryId, aspect, status: "running", tokenShare: share.tokens, usdShare: share.usd }
        });
        await this.notify();
        return a.id;
    }

    async finishAgent(agentRunId: string, o: AgentOutcome) {
        const status = o.status === "failed" ? "failed" : o.status;
        await prisma.$transaction([
            prisma.agentRun.update({
                where: { id: agentRunId },
                data: { status, summary: o.summary, coverage: o.coverage, note: o.note, finishedAt: new Date() }
            }),
            this.notify()
        ]);
    }

    async supersedeUnreviewed(repositoryId: string | null, aspect: string) {
        // The project too: the seams pass's findings have no repository to scope them.
        const where = { projectId: this.projectId, repositoryId, aspect, source: "agent" as const, status: "unreviewed" as const };
        await prisma.$transaction(async tx => {
            const ids = (await tx.finding.findMany({ where, select: { id: true } })).map(r => r.id);
            // Still unreviewed at the write: one Andrii reviewed meanwhile stays as he left it.
            await tx.finding.updateMany({ where: { id: { in: ids }, status: "unreviewed" }, data: { status: "superseded" } });
            const gone = (await tx.finding.findMany({ where: { id: { in: ids }, status: "superseded" }, select: { id: true } })).map(
                r => r.id
            );
            // Whatever was merged into them comes back to the review: a scanner's, which nothing would file
            // again, and an agent's Andrii merged by hand, which would otherwise stay hidden behind a gap.
            await tx.finding.updateMany({
                where: { mergedIntoId: { in: gone }, status: "merged" },
                data: { status: "unreviewed", mergedIntoId: null }
            });
        });
    }
}

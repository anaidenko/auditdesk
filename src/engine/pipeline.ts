import type Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";

import type { Effort } from "./agent/request";
import type { AgentOutcome } from "./agent/run-aspect";
import { runAspect } from "./agent/run-aspect";
import { shareFor } from "./budget";
import { loadChecklist } from "./checklists";
import { readSnippet } from "./files";
import { Masker } from "./masker";
import { aspectMessage, prefixBlocks } from "./prompts";
import { buildRepoMap } from "./repomap";
import { normaliseGitleaks } from "./scanners/gitleaks";
import { leakInTree, leakMasks, runScanners } from "./scanners/index";
import { normaliseOsv } from "./scanners/osv";
import { normaliseSemgrep } from "./scanners/semgrep";
import type { Ruleset, ScannerRunner, ToolVersions } from "./scanners/types";
import type { AuditSink } from "./types";
import { cloneRepository } from "./workspace";

export interface PipelineSink extends AuditSink {
    repositoryCloned(repositoryId: string, sha: string, clonePath: string): Promise<void>;
    toolVersions(v: ToolVersions): Promise<void>;
    startAgent(repositoryId: string, aspect: string, share: { usd: number; tokens: number }): Promise<string>;
    finishAgent(agentRunId: string, outcome: AgentOutcome): Promise<void>;
    supersedeUnreviewed(repositoryId: string, aspect: string): Promise<void>;
}

export interface AuditInput {
    runId: string;
    projectId: string;
    model: string;
    effort: Effort;
    budget: { usd: number; tokens: number };
    /** `sha` is set on a re-run: the commit the run already audited, whatever the branch says now. */
    repositories: { id: string; source: string; branch: string; sha?: string | null }[];
    aspects: string[];
    /** A re-run of one aspect in one repository (design § 9). */
    only?: { repositoryId: string; aspect: string };
}

export interface AuditDeps {
    sink: PipelineSink;
    client: Anthropic;
    scanners: ScannerRunner;
    fetchRulesets: (dir: string) => Promise<Ruleset[]>;
    workspaceDir: string;
    checklistsDir: string;
}

export async function runAudit(input: AuditInput, deps: AuditDeps): Promise<{ stopped: boolean }> {
    const { sink } = deps;
    const agentsInRun = input.repositories.length * input.aspects.length;
    const fullShare = shareFor(input.budget, agentsInRun);

    for (const repo of input.repositories) {
        if (input.only && input.only.repositoryId !== repo.id) continue;
        if (await sink.stopRequested()) return { stopped: true };

        await sink.progress(`Cloning ${repo.source} at ${repo.branch}…`);
        const { sha, clonePath } = await cloneRepository({
            source: repo.source,
            branch: repo.branch,
            sha: repo.sha,
            workspaceDir: deps.workspaceDir,
            projectId: input.projectId,
            repositoryId: repo.id
        });
        await sink.repositoryCloned(repo.id, sha, clonePath);

        await sink.progress("Running gitleaks, osv-scanner and Semgrep…");
        const runDir = join(deps.workspaceDir, input.projectId, "runs", input.runId);
        const rulesDir = join(runDir, "rules");
        const scan = await runScanners({
            clonePath,
            runner: deps.scanners,
            rulesets: await deps.fetchRulesets(rulesDir),
            rulesDir,
            configDir: join(runDir, "gitleaks")
        });
        await sink.toolVersions(scan.versions);
        const masker = new Masker(await leakMasks(clonePath, scan.leaks));
        const inTree = new Set<string>();
        for (const leak of scan.leaks) if (await leakInTree(clonePath, leak)) inTree.add(`${leak.File}:${leak.StartLine}:${leak.Commit}`);
        const known = await sink.knownFingerprints(repo.id);
        const scannerFindings = [
            ...normaliseGitleaks(scan.leaks, {
                repositoryId: repo.id,
                masker,
                inTree: l => inTree.has(`${l.File}:${l.StartLine}:${l.Commit}`)
            }),
            ...normaliseOsv(scan.osv, { repositoryId: repo.id }),
            // Semgrep's own `extra.lines` reads "requires login" without a Semgrep account: the code comes from the clone.
            ...normaliseSemgrep(
                await Promise.all(
                    scan.semgrep.map(async r => ({
                        ...r,
                        extra: {
                            ...r.extra,
                            lines: (await readSnippet(clonePath, r.path, r.start.line, r.end.line, l => masker.mask(l))) ?? ""
                        }
                    }))
                ),
                { repositoryId: repo.id, masker }
            )
        ];
        let filed = 0;
        for (const f of scannerFindings) {
            if (known.has(f.fingerprint)) continue;
            known.add(f.fingerprint);
            await sink.createFinding(f);
            filed++;
        }
        await sink.progress(`Scanners filed ${filed} new findings (${scan.leaks.length} secrets masked from here on).`);

        await sink.progress("Building the repository map…");
        const repoMap = await buildRepoMap(clonePath, masker);
        const system = prefixBlocks({
            stackProfile: "Not detected in this version; read the repository map.",
            repoMap,
            brief: "No brief was written for this audit."
        });

        for (const aspect of input.aspects) {
            if (input.only && input.only.aspect !== aspect) continue;
            if (await sink.stopRequested()) return { stopped: true };
            const spent = await sink.runSpend();
            if (spent.unpriced) {
                // The dollars already spent are unknown, so no share of what is left can be computed.
                await sink.progress(
                    `Skipped ${aspect}: budget unknown, because a call of this run was served by a model with no price row.`,
                    "warn"
                );
                continue;
            }
            const remaining = input.budget.usd - spent.usd;
            const share = { usd: Math.min(fullShare.usd, Math.max(remaining, 0)), tokens: fullShare.tokens };
            if (share.usd <= 0) {
                await sink.progress(`Skipped ${aspect}: the run's budget is spent.`, "warn");
                continue;
            }
            if (input.only) await sink.supersedeUnreviewed(repo.id, aspect);
            const checklist = await loadChecklist(aspect, deps.checklistsDir);
            const agentRunId = await sink.startAgent(repo.id, aspect, share);
            await sink.progress(`Agent: ${checklist.title} (${share.tokens.toLocaleString("en-US")} tokens, $${share.usd.toFixed(2)})…`);
            const outcome = await runAspect({
                client: deps.client,
                model: input.model,
                effort: input.effort,
                share,
                ctx: {
                    clonePath,
                    repositoryId: repo.id,
                    agentRunId,
                    aspect,
                    checklist,
                    masker,
                    repoMap,
                    sink,
                    state: { finished: null, reported: [], fatal: null }
                },
                system,
                firstMessage: aspectMessage({ checklist, findingIndex: await sink.findingIndex(repo.id), budgetTokens: share.tokens })
            }).catch(async (e: Error) => {
                // Recorded before the run fails, or the agent would show "running" forever.
                await sink
                    .finishAgent(agentRunId, { status: "failed", note: `Error: ${e.message}`, summary: null, coverage: [] })
                    .catch(() => {});
                throw e;
            });
            await sink.finishAgent(agentRunId, outcome);
            await sink.progress(
                `${checklist.title}: ${outcome.status}${outcome.note ? ` — ${outcome.note}` : ""}`,
                outcome.status === "done" ? "info" : "warn"
            );
            if (outcome.status === "stopped") return { stopped: true };
        }
    }
    await sink.progress("Run finished.");
    return { stopped: false };
}

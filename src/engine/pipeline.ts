import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Effort } from "./agent/request";
import type { AgentOutcome, AspectRunner } from "./agent/run-aspect";
import { aspectTitle } from "./aspects";
import { shareFor } from "./budget";
import { forMode, loadChecklist } from "./checklists";
import { readSnippet } from "./files";
import { Masker } from "./masker";
import { resolveInClone } from "./paths";
import { type Brief, aspectMessage, briefText, prefixBlocks } from "./prompts";
import { type EarlierFinding, type RecheckStatus, recheck } from "./recheck";
import { buildRepoMap } from "./repomap";
import { normaliseGitleaks } from "./scanners/gitleaks";
import { type ScanResults, leakInTree, leakMasks, runGitleaks, runScanners } from "./scanners/index";
import { normaliseOsv, osvEvidence } from "./scanners/osv";
import { normaliseSemgrep } from "./scanners/semgrep";
import type { Ruleset, ScannerRunner, ToolVersions } from "./scanners/types";
import { type StackProfile, detectStack, stackProfileText } from "./stack";
import type { AuditSink, SeverityName } from "./types";
import { cloneRepository } from "./workspace";

export interface PipelineSink extends AuditSink {
    repositoryCloned(repositoryId: string, sha: string, clonePath: string): Promise<void>;
    stackDetected(repositoryId: string, profile: StackProfile): Promise<void>;
    toolVersions(v: ToolVersions): Promise<void>;
    startAgent(repositoryId: string, aspect: string, share: { usd: number; tokens: number }): Promise<string>;
    finishAgent(agentRunId: string, outcome: AgentOutcome): Promise<void>;
    supersedeUnreviewed(repositoryId: string, aspect: string): Promise<void>;
    /**
     * Merges the run's unreviewed scanner findings that the agent filed again into the agent's own;
     * `raised` is the scanner's higher severity, which the agent's finding takes.
     */
    foldScannerDuplicates(repositoryId: string, agentRunId: string): Promise<{ from: string; into: string; raised?: SeverityName }[]>;
    /** The repository's reported findings from runs at another commit, which a full run re-checks (design § 9). */
    earlierFindings(repositoryId: string, sha: string): Promise<EarlierFinding[]>;
    /** The fingerprints of the findings this run filed in the repository. */
    filedFingerprints(repositoryId: string): Promise<Set<string>>;
    recheckFindings(results: { id: string; status: RecheckStatus }[], sha: string): Promise<void>;
}

export interface AuditInput {
    runId: string;
    projectId: string;
    model: string;
    effort: Effort;
    budget: { usd: number; tokens: number };
    /** `sha` is set on a re-run: the commit the run already audited, whatever the branch says now. */
    repositories: {
        id: string;
        source: string;
        branch: string;
        sha?: string | null;
        /** The stack profile as the auditor confirmed or edited it; detected afresh when absent (design § 6). */
        stackText?: string | null;
        instructions?: string | null;
    }[];
    brief?: Brief;
    aspects: string[];
    /** A re-run of one aspect in one repository (design § 9). */
    only?: { repositoryId: string; aspect: string };
}

export interface AuditDeps {
    sink: PipelineSink;
    /** The aspect agent on the run's engine: the Messages API or the Agent SDK. */
    runAspect: AspectRunner;
    scanners: ScannerRunner;
    fetchRulesets: (dir: string) => Promise<Ruleset[]>;
    workspaceDir: string;
    checklistsDir: string;
}

export async function runAudit(input: AuditInput, deps: AuditDeps): Promise<{ stopped: boolean }> {
    const { sink } = deps;
    const agentsInRun = input.repositories.length * input.aspects.length;
    const fullShare = shareFor(input.budget, agentsInRun);

    const runDir = join(deps.workspaceDir, input.projectId, "runs", input.runId);
    const rulesDir = join(runDir, "rules");

    // Every repository is cloned and scanned before any agent starts: the brief reaches every agent,
    // so it is masked with the secrets gitleaks found in all of them (design § 6). A re-run of one
    // repository runs gitleaks alone on the others.
    const scanned: { repo: AuditInput["repositories"][number]; sha: string; clonePath: string; scan: ScanResults }[] = [];
    const masks: { value: string; rule: string }[] = [];
    for (const repo of input.repositories) {
        if (await sink.stopRequested()) return { stopped: true };
        const target = !input.only || input.only.repositoryId === repo.id;
        await sink.progress(`Cloning ${repo.source} at ${repo.branch}…`);
        const { sha, clonePath } = await cloneRepository({
            source: repo.source,
            branch: repo.branch,
            sha: repo.sha,
            workspaceDir: deps.workspaceDir,
            projectId: input.projectId,
            repositoryId: repo.id
        });
        if (!target) {
            await sink.progress("Running gitleaks, so this repository's secrets stay out of the brief…");
            const leaks = await runGitleaks({ clonePath, runner: deps.scanners, configDir: join(runDir, "gitleaks") });
            masks.push(...(await leakMasks(clonePath, leaks)));
            continue;
        }
        await sink.repositoryCloned(repo.id, sha, clonePath);
        await sink.progress("Running gitleaks, osv-scanner and Semgrep…");
        const scan = await runScanners({
            clonePath,
            runner: deps.scanners,
            rulesets: await deps.fetchRulesets(rulesDir),
            rulesDir,
            configDir: join(runDir, "gitleaks")
        });
        await sink.toolVersions(scan.versions);
        masks.push(...(await leakMasks(clonePath, scan.leaks)));
        scanned.push({ repo, sha, clonePath, scan });
    }
    const masker = new Masker(masks);

    for (const { repo, sha, clonePath, scan } of scanned) {
        const inTree = new Set<string>();
        for (const leak of scan.leaks) if (await leakInTree(clonePath, leak)) inTree.add(`${leak.File}:${leak.StartLine}:${leak.Commit}`);
        const known = await sink.knownFingerprints(repo.id);
        const lockEntries = await osvEvidence(clonePath, scan.osv, l => masker.mask(l));
        const scannerFindings = [
            ...normaliseGitleaks(scan.leaks, {
                repositoryId: repo.id,
                masker,
                inTree: l => inTree.has(`${l.File}:${l.StartLine}:${l.Commit}`)
            }),
            ...normaliseOsv(scan.osv, { repositoryId: repo.id, locate: p => lockEntries.get(p) ?? null }),
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
        const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
        await sink.progress(
            `Scanners filed ${count(filed, "new finding", "new findings")} (${count(scan.leaks.length, "secret", "secrets")} masked from here on).`
        );

        await sink.progress("Building the repository map…");
        const repoMap = await buildRepoMap(clonePath, masker);
        let stackText = repo.stackText?.trim();
        if (!stackText) {
            const profile = await detectStack(clonePath);
            await sink.stackDetected(repo.id, profile);
            stackText = `${stackProfileText(profile)}\n\nDetected from the manifests; the auditor has not confirmed it yet.`;
        }
        const system = prefixBlocks({
            stackProfile: masker.mask(stackText),
            repoMap,
            brief: masker.mask(briefText(input.brief, repo.instructions))
        });

        for (const aspect of input.aspects) {
            if (input.only && input.only.aspect !== aspect) continue;
            if (await sink.stopRequested()) return { stopped: true };
            const spent = await sink.runSpend();
            if (spent.unpriced) {
                // The dollars already spent are unknown, so no share of what is left can be computed.
                await sink.progress(
                    `Skipped ${aspectTitle(aspect)}: budget unknown, because a call of this run was served by a model with no price row.`,
                    "warn"
                );
                continue;
            }
            const remaining = input.budget.usd - spent.usd;
            const share = { usd: Math.min(fullShare.usd, Math.max(remaining, 0)), tokens: fullShare.tokens };
            if (share.usd <= 0) {
                await sink.progress(`Skipped ${aspectTitle(aspect)}: the run's budget is spent.`, "warn");
                continue;
            }
            if (input.only) await sink.supersedeUnreviewed(repo.id, aspect);
            const checklist = forMode(await loadChecklist(aspect, deps.checklistsDir), input.brief?.aiBuilt ?? false);
            const agentRunId = await sink.startAgent(repo.id, aspect, share);
            await sink.progress(`Agent: ${checklist.title} (${share.tokens.toLocaleString("en-US")} tokens, $${share.usd.toFixed(2)})…`);
            const outcome = await deps
                .runAspect({
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
                    firstMessage: aspectMessage({
                        checklist,
                        findingIndex: await sink.findingIndex(repo.id),
                        budgetTokens: share.tokens,
                        aiBuilt: input.brief?.aiBuilt,
                        runAspects: input.aspects.map(aspectTitle)
                    })
                })
                .catch(async (e: Error) => {
                    // Recorded before the run fails, or the agent would show "running" forever.
                    await sink
                        .finishAgent(agentRunId, { status: "failed", note: `Error: ${e.message}`, summary: null, coverage: [] })
                        .catch(() => {});
                    throw e;
                });
            await sink.finishAgent(agentRunId, outcome);
            try {
                for (const f of await sink.foldScannerDuplicates(repo.id, agentRunId))
                    await sink.progress(
                        `Folded ${f.from} into ${f.into}: the scanner's finding repeats the agent's.${f.raised ? ` ${f.into} takes its ${f.raised} severity.` : ""}`
                    );
            } catch (e) {
                // A finding reviewed while the fold ran: the duplicates stay apart, and the audit goes on.
                await sink.progress(`Did not fold the scanner's duplicates: ${(e as Error).message}`, "warn");
            }
            await sink.progress(
                `${checklist.title}: ${outcome.status}${outcome.note ? ` — ${outcome.note}` : ""}`,
                outcome.status === "done" ? "info" : "warn"
            );
            if (outcome.status === "stopped") return { stopped: true };
        }
        if (!input.only) {
            const earlier = await sink.earlierFindings(repo.id, sha);
            if (earlier.length) {
                const results = await recheck(earlier, {
                    scannerSeen: new Set(scannerFindings.map(f => f.fingerprint)),
                    filedNow: await sink.filedFingerprints(repo.id),
                    read: async file => {
                        try {
                            const { abs } = await resolveInClone(clonePath, file);
                            return (await readFile(abs, "utf8")).split(/\r?\n/).map(l => masker.mask(l));
                        } catch {
                            return null;
                        }
                    }
                });
                await sink.recheckFindings(results, sha);
                const of = (status: RecheckStatus) => results.filter(r => r.status === status).map(r => r.label);
                const part = (status: RecheckStatus, words: string, list: boolean) =>
                    of(status).length ? `${of(status).length} ${words}${list ? ` (${of(status).join(", ")})` : ""}` : "";
                const parts = [
                    part("fixed", "fixed", true),
                    part("open", "still open", false),
                    part("regressed", "regressed", true),
                    part("changed", "changed, to verify", true)
                ].filter(Boolean);
                await sink.progress(
                    `Re-checked ${count(earlier.length, "earlier finding", "earlier findings")} against ${sha.slice(0, 7)}: ${parts.join(", ")}.`
                );
            }
        }
    }
    await sink.progress("Run finished.");
    return { stopped: false };
}

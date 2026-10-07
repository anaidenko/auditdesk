import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Effort } from "./agent/request";
import type { AgentOutcome, AspectRunner } from "./agent/run-aspect";
import type { AgentContext } from "./agent/tools";
import { SEAMS, agentCount, aspectTitle } from "./aspects";
import { shareFor } from "./budget";
import { forMode, loadChecklist } from "./checklists";
import { readSnippet } from "./files";
import { Masker } from "./masker";
import { resolveInClone } from "./paths";
import { type Brief, aspectMessage, briefText, prefixBlocks } from "./prompts";
import { type EarlierFinding, type RecheckResult, type RecheckStatus, recheck } from "./recheck";
import { buildRepoMap } from "./repomap";
import { normaliseGitleaks } from "./scanners/gitleaks";
import { type ScanResults, leakInTree, leakMasks, runGitleaks, runScanners } from "./scanners/index";
import { normaliseOsv, osvEvidence } from "./scanners/osv";
import { normaliseSemgrep } from "./scanners/semgrep";
import type { Ruleset, ScannerRunner, ToolVersions } from "./scanners/types";
import { shortSha } from "./short-sha";
import { type StackProfile, detectStack, stackProfileText } from "./stack";
import type { AuditSink, SeverityName } from "./types";
import { cloneRepository } from "./workspace";

export interface PipelineSink extends AuditSink {
    repositoryCloned(repositoryId: string, sha: string, clonePath: string): Promise<void>;
    stackDetected(repositoryId: string, profile: StackProfile): Promise<void>;
    toolVersions(v: ToolVersions): Promise<void>;
    startAgent(repositoryId: string, aspect: string, share: { usd: number; tokens: number }): Promise<string>;
    finishAgent(agentRunId: string, outcome: AgentOutcome): Promise<void>;
    /** `repositoryId` null: the seams pass's findings, which belong to no single repository. */
    supersedeUnreviewed(repositoryId: string | null, aspect: string): Promise<void>;
    /**
     * Merges the run's unreviewed scanner findings that the agent filed again into the agent's own;
     * `raised` is the scanner's higher severity, which the agent's finding takes.
     */
    foldScannerDuplicates(repositoryId: string, agentRunId: string): Promise<{ from: string; into: string; raised?: SeverityName }[]>;
    /**
     * The repository's reported findings from runs at another commit, which a full run re-checks
     * (design § 9); with null, the seams pass's findings, at every repository's commit joined by "+".
     */
    earlierFindings(repositoryId: string | null, sha: string): Promise<EarlierFinding[]>;
    recheckFindings(results: RecheckResult[], sha: string): Promise<void>;
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

/**
 * A name per repository that a path can start with: the folder or the URL's last part, told apart
 * by branch and then by number. The seams agent reads `web/src/api.ts`.
 */
export function pathNames(repositories: { id: string; source: string; branch: string }[]): Map<string, string> {
    const slug = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "repository";
    const base = (r: { source: string }) =>
        slug(
            r.source
                .replace(/[/\\]+$/, "")
                .replace(/\.git$/, "")
                .split(/[/\\:]/)
                .pop() ?? ""
        );
    const names = new Map<string, string>();
    for (const r of repositories) {
        const clash = repositories.filter(x => base(x) === base(r)).length > 1;
        let name = clash ? `${base(r)}-${slug(r.branch)}` : base(r);
        for (let i = 2; [...names.values()].includes(name); i++) name = `${base(r)}-${i}`;
        names.set(r.id, name);
    }
    return names;
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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function runAudit(input: AuditInput, deps: AuditDeps): Promise<{ stopped: boolean }> {
    const { sink } = deps;
    const seams = input.aspects.includes(SEAMS);
    const perRepo = input.aspects.filter(a => a !== SEAMS);
    const agentsInRun = agentCount(input.repositories.length, input.aspects);
    const fullShare = shareFor(input.budget, agentsInRun);
    const names = pathNames(input.repositories);
    const views: { name: string; repo: AuditInput["repositories"][number]; clonePath: string; repoMap: string; stackText: string }[] = [];

    const runDir = join(deps.workspaceDir, input.projectId, "runs", input.runId);
    const rulesDir = join(runDir, "rules");

    // Every repository is cloned and scanned before any agent starts: the brief reaches every agent,
    // so it is masked with the secrets gitleaks found in all of them (design § 6). A re-run of one
    // repository runs gitleaks alone on the others; a re-run of the seams pass, on all of them, since
    // it reads each repository's map and files nothing from the scanners. `scan` is null then.
    const seamsOnly = input.only?.aspect === SEAMS;
    const scanned: { repo: AuditInput["repositories"][number]; sha: string; clonePath: string; scan: ScanResults | null }[] = [];
    const masks: { value: string; rule: string }[] = [];
    for (const repo of input.repositories) {
        if (await sink.stopRequested()) return { stopped: true };
        const target = !input.only || seamsOnly || input.only.repositoryId === repo.id;
        await sink.progress(`Cloning ${repo.source} at ${repo.branch}…`);
        const { sha, clonePath } = await cloneRepository({
            source: repo.source,
            branch: repo.branch,
            sha: repo.sha,
            workspaceDir: deps.workspaceDir,
            projectId: input.projectId,
            repositoryId: repo.id
        });
        if (!target || seamsOnly) {
            await sink.progress("Running gitleaks, so this repository's secrets stay out of the brief…");
            const leaks = await runGitleaks({ clonePath, runner: deps.scanners, configDir: join(runDir, "gitleaks") });
            masks.push(...(await leakMasks(clonePath, leaks)));
            if (seamsOnly) scanned.push({ repo, sha, clonePath, scan: null });
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
    const readMasked = async (clonePath: string, file: string) => {
        try {
            const { abs } = await resolveInClone(clonePath, file);
            return (await readFile(abs, "utf8")).split(/\r?\n/).map(l => masker.mask(l));
        } catch {
            return null;
        }
    };
    const reportRecheck = async (results: RecheckResult[], what: string) => {
        const news = results.filter(r => !r.keep);
        const of = (status: RecheckStatus) => news.filter(r => r.status === status).map(r => r.label);
        const part = (status: RecheckStatus, words: string, list: boolean) =>
            of(status).length ? `${of(status).length} ${words}${list ? ` (${of(status).join(", ")})` : ""}` : "";
        const parts = [
            part("fixed", "fixed", true),
            part("unchanged", "with code unchanged", false),
            part("open", "still open as confirmed", false),
            part("regressed", "regressed", true),
            part("changed", "changed, to verify", true),
            results.length - news.length ? `${results.length - news.length} fixed before` : ""
        ].filter(Boolean);
        await sink.progress(`Re-checked ${count(results.length, "earlier finding", "earlier findings")} ${what}: ${parts.join(", ")}.`);
    };

    // The seams pass's findings cite several repositories, so they are re-checked once, with every
    // clone in place and before any agent starts; a path names its repository first.
    if (!input.only) {
        const commit = scanned.map(s => s.sha).join("+");
        const earlier = await sink.earlierFindings(null, commit);
        if (earlier.length) {
            const results = await recheck(earlier, {
                scanners: [],
                read: async file => {
                    const at = scanned.find(s => file.startsWith(`${names.get(s.repo.id)}/`));
                    return at ? readMasked(at.clonePath, file.slice(names.get(at.repo.id)!.length + 1)) : null;
                }
            });
            await sink.recheckFindings(results, commit);
            await reportRecheck(results, `of the seams pass against ${shortSha(commit)}`);
        }
    }

    for (const { repo, sha, clonePath, scan } of scanned) {
        if (scan) {
            const inTree = new Set<string>();
            for (const leak of scan.leaks)
                if (await leakInTree(clonePath, leak)) inTree.add(`${leak.File}:${leak.StartLine}:${leak.Commit}`);
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
            await sink.progress(
                `Scanners filed ${count(filed, "new finding", "new findings")} (${count(scan.leaks.length, "secret", "secrets")} masked from here on).`
            );

            // Before the agents, so a run stopped or failed later still has its re-check.
            if (!input.only) {
                const earlier = await sink.earlierFindings(repo.id, sha);
                if (earlier.length) {
                    const results = await recheck(earlier, { scanners: scannerFindings, read: file => readMasked(clonePath, file) });
                    await sink.recheckFindings(results, sha);
                    await reportRecheck(results, `against ${shortSha(sha)}`);
                }
            }
        }

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

        views.push({ name: names.get(repo.id)!, repo, clonePath, repoMap, stackText: masker.mask(stackText) });

        for (const aspect of perRepo) {
            if (input.only && input.only.aspect !== aspect) continue;
            if (await sink.stopRequested()) return { stopped: true };
            const outcome = await runAgent({
                aspect,
                repositoryId: repo.id,
                view: { clonePath, repoMap },
                system,
                before: input.only ? () => sink.supersedeUnreviewed(repo.id, aspect) : undefined,
                findingIndex: async () => [
                    ...(await sink.findingIndex(repo.id)),
                    ...(await sink.findingIndex(null, { cites: names.get(repo.id)! })).map(l => `Across repositories: ${l}`)
                ],
                after: async agentRunId => {
                    try {
                        for (const f of await sink.foldScannerDuplicates(repo.id, agentRunId))
                            await sink.progress(
                                `Folded ${f.from} into ${f.into}: the scanner's finding repeats the agent's.${f.raised ? ` ${f.into} takes its ${f.raised} severity.` : ""}`
                            );
                    } catch (e) {
                        // A finding reviewed while the fold ran: the duplicates stay apart, and the audit goes on.
                        await sink.progress(`Did not fold the scanner's duplicates: ${(e as Error).message}`, "warn");
                    }
                }
            });
            if (outcome?.status === "stopped") return { stopped: true };
        }
    }

    // The seams pass: one agent reads every repository at once, after their own aspects (design § 6).
    if (seams && (!input.only || input.only.aspect === SEAMS)) {
        if (views.length < 2) await sink.progress(`Skipped ${aspectTitle(SEAMS)}: the project has one repository.`, "warn");
        else {
            if (await sink.stopRequested()) return { stopped: true };
            const section = (text: (v: (typeof views)[number]) => string) => views.map(v => `## ${v.name}\n\n${text(v)}`).join("\n\n");
            const outcome = await runAgent({
                aspect: SEAMS,
                repositoryId: views[0].repo.id,
                view: {
                    clonePath: views[0].clonePath,
                    repoMap: section(v => v.repoMap),
                    roots: views.map(v => ({ name: v.name, clonePath: v.clonePath, repositoryId: v.repo.id }))
                },
                system: prefixBlocks({
                    stackProfile: section(v => v.stackText),
                    repoMap: section(v => v.repoMap),
                    brief: masker.mask(
                        [
                            briefText(input.brief),
                            ...views.map(v => v.repo.instructions?.trim() && `How to run ${v.name}: ${v.repo.instructions.trim()}`)
                        ]
                            .filter(Boolean)
                            .join("\n\n")
                    )
                }),
                before: input.only ? () => sink.supersedeUnreviewed(null, SEAMS) : undefined,
                findingIndex: async () => [
                    ...(await Promise.all(views.map(async v => (await sink.findingIndex(v.repo.id)).map(l => `${v.name}: ${l}`)))).flat(),
                    ...(await sink.findingIndex(null))
                ]
            });
            if (outcome?.status === "stopped") return { stopped: true };
        }
    }
    await sink.progress("Run finished.");
    return { stopped: false };

    /** One agent: its share of what the run has left, its run and its outcome; null when the budget skipped it. */
    async function runAgent(a: {
        aspect: string;
        repositoryId: string;
        view: { clonePath: string; repoMap: string; roots?: AgentContext["roots"] };
        system: ReturnType<typeof prefixBlocks>;
        findingIndex: () => Promise<string[]>;
        before?: () => Promise<void>;
        after?: (agentRunId: string) => Promise<void>;
    }): Promise<AgentOutcome | null> {
        const spent = await sink.runSpend();
        if (spent.unpriced) {
            // The dollars already spent are unknown, so no share of what is left can be computed.
            await sink.progress(
                `Skipped ${aspectTitle(a.aspect)}: budget unknown, because a call of this run was served by a model with no price row.`,
                "warn"
            );
            return null;
        }
        const remaining = input.budget.usd - spent.usd;
        const share = { usd: Math.min(fullShare.usd, Math.max(remaining, 0)), tokens: fullShare.tokens };
        if (share.usd <= 0) {
            await sink.progress(`Skipped ${aspectTitle(a.aspect)}: the run's budget is spent.`, "warn");
            return null;
        }
        await a.before?.();
        const checklist = forMode(await loadChecklist(a.aspect, deps.checklistsDir), input.brief?.aiBuilt ?? false);
        const agentRunId = await sink.startAgent(a.repositoryId, a.aspect, share);
        await sink.progress(`Agent: ${checklist.title} (${share.tokens.toLocaleString("en-US")} tokens, $${share.usd.toFixed(2)})…`);
        const outcome = await deps
            .runAspect({
                model: input.model,
                effort: input.effort,
                share,
                ctx: {
                    clonePath: a.view.clonePath,
                    repositoryId: a.repositoryId,
                    agentRunId,
                    aspect: a.aspect,
                    checklist,
                    masker,
                    repoMap: a.view.repoMap,
                    sink,
                    ...(a.view.roots ? { roots: a.view.roots } : {}),
                    state: { finished: null, reported: [], fatal: null }
                },
                system: a.system,
                firstMessage: aspectMessage({
                    checklist,
                    findingIndex: await a.findingIndex(),
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
        await a.after?.(agentRunId);
        await sink.progress(
            `${checklist.title}: ${outcome.status}${outcome.note ? ` — ${outcome.note}` : ""}`,
            outcome.status === "done" ? "info" : "warn"
        );
        return outcome;
    }
}

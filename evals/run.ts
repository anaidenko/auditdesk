import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DEFAULT_EFFORT, DEFAULT_MODEL, type Effort } from "@/engine/agent/request";
import type { AgentOutcome, AspectRunner } from "@/engine/agent/run-aspect";
import { ASPECTS, aspectTitle } from "@/engine/aspects";
import { git } from "@/engine/git";
import { MemorySink } from "@/engine/memory-sink";
import { EFFORTS, MODEL_CHOICES } from "@/engine/models";
import { type PipelineSink, runAudit } from "@/engine/pipeline";
import { PRICES_AS_OF } from "@/engine/prices";
import type { Ruleset, ScannerRunner, ToolVersions } from "@/engine/scanners/types";
import type { ModelAccess } from "@/engine/types";

import { type AnswerKey, type FixtureSpec, fixturePath, keyProblems, loadFixtures, loadKey } from "./fixtures";
import { type GradedFinding, grade } from "./grade";
import { judgeLeftovers } from "./judge";
import { prepareFixture } from "./prep/fixture";
import { JUICE_SHOP_RULES } from "./prep/juice-shop";
import type { StripRules } from "./prep/strip";
import { type EvalResult, summaryMarkdown } from "./summary";

export type { EvalResult } from "./summary";

export interface EvalOptions {
    fixture: string;
    /** One aspect only; otherwise the fixture's own list. */
    aspect?: string;
    model: string;
    effort: Effort;
    budgetUsd: number;
    budgetTokens: number;
    access: ModelAccess;
    judge: boolean;
    /** The judge's own cap, since it bills the API key whatever the run's access. */
    judgeUsd?: number;
}

export interface EvalDeps {
    runAspect: AspectRunner;
    scanners: ScannerRunner;
    fetchRulesets: (dir: string) => Promise<Ruleset[]>;
    workspaceDir: string;
    resultsDir: string;
    /** The judge's client: the Messages API, so an API key. */
    judge?: Anthropic;
    fixtures?: FixtureSpec[];
    loadKey?: (fixture: string) => AnswerKey;
    now?: () => Date;
}

const STRIP_RULES: Record<string, StripRules> = { "juice-shop": JUICE_SHOP_RULES };
const NO_RULES: StripRules = { deletePaths: [], statementPatterns: [] };
const DEFAULT_TOKENS = 400_000;

const USAGE =
    "pnpm eval --fixture <name> --access api_key|claude_plan --budget-usd <dollars> [--budget-tokens <n>] [--aspect <key>] [--model <id>] [--effort <level>] [--judge --judge-usd <dollars>]";
const FLAGS = ["--fixture", "--access", "--budget-usd", "--budget-tokens", "--aspect", "--model", "--effort", "--judge", "--judge-usd"];

export function parseEvalArgs(argv: string[]): { ok: true; value: EvalOptions } | { ok: false; error: string } {
    const flags = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) return { ok: false, error: `Unexpected argument ${a}. ${USAGE}` };
        if (!FLAGS.includes(a)) return { ok: false, error: `Unknown flag ${a}. ${USAGE}` };
        if (a === "--judge") flags.set(a, true);
        else if (i + 1 < argv.length) flags.set(a, argv[++i]);
        else return { ok: false, error: `${a} needs a value. ${USAGE}` };
    }
    const str = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined);
    const fixture = str("--fixture");
    if (!fixture) return { ok: false, error: `--fixture is required. ${USAGE}` };
    const access = str("--access");
    if (access !== "api_key" && access !== "claude_plan")
        return {
            ok: false,
            error: `--access is required, api_key or claude_plan: one bills per token, the other spends the plan's window.`
        };
    const budgetUsd = Number(str("--budget-usd"));
    if (!str("--budget-usd") || !(budgetUsd > 0))
        return { ok: false, error: "--budget-usd is required: an eval run names its cap before it starts." };
    const budgetTokens = str("--budget-tokens") === undefined ? DEFAULT_TOKENS : Number(str("--budget-tokens"));
    if (!(budgetTokens > 0)) return { ok: false, error: "--budget-tokens must be a positive number." };
    const model = str("--model") ?? DEFAULT_MODEL;
    if (!MODEL_CHOICES.some(m => m.id === model))
        return { ok: false, error: `Unknown model ${model}: ${MODEL_CHOICES.map(m => m.id).join(", ")}.` };
    const effort = (str("--effort") ?? DEFAULT_EFFORT) as Effort;
    if (!EFFORTS.includes(effort)) return { ok: false, error: `Unknown effort ${effort}: ${EFFORTS.join(", ")}.` };
    const aspect = str("--aspect");
    if (aspect !== undefined && !ASPECTS.some(a => a.key === aspect)) return { ok: false, error: `Unknown aspect ${aspect}.` };
    const judge = flags.get("--judge") === true;
    const judgeUsd = Number(str("--judge-usd"));
    if (judge && !(judgeUsd > 0))
        return { ok: false, error: "--judge needs --judge-usd: the judge bills the API key apart from the run's cap." };
    if (!judge && str("--judge-usd") !== undefined) return { ok: false, error: "--judge-usd is the judge's cap: it needs --judge." };
    return {
        ok: true,
        value: {
            fixture,
            ...(aspect ? { aspect } : {}),
            model,
            effort,
            budgetUsd,
            budgetTokens,
            access,
            judge,
            ...(judge ? { judgeUsd } : {})
        }
    };
}

class EvalSink extends MemorySink implements PipelineSink {
    agents: { id: string; aspect: string; outcome: AgentOutcome | null }[] = [];
    versions: ToolVersions | null = null;
    async repositoryCloned() {}
    async stackDetected() {}
    async toolVersions(v: ToolVersions) {
        this.versions = v;
    }
    async startAgent(_repositoryId: string, aspect: string) {
        const id = `agent-${this.agents.length + 1}`;
        this.agents.push({ id, aspect, outcome: null });
        return id;
    }
    async finishAgent(id: string, outcome: AgentOutcome) {
        this.agents.find(a => a.id === id)!.outcome = outcome;
    }
    async supersedeUnreviewed() {}
}

/**
 * One eval run (design § 5, § 11): prepares the fixture at its pinned commit, checks the key fits it,
 * runs the audit bare with an in-memory sink, grades the findings against the key and writes the
 * result file; with --judge, judges what the grader could not place and writes the file again.
 * An audit that fails still gets its file, with the reason; so does a judge that stops.
 */
export async function runEval(o: EvalOptions, deps: EvalDeps): Promise<{ file: string; result: EvalResult }> {
    const spec = (deps.fixtures ?? loadFixtures()).find(f => f.name === o.fixture);
    if (!spec) throw new Error(`No fixture named ${o.fixture} in evals/fixtures.yaml`);
    const key = (deps.loadKey ?? loadKey)(spec.name);
    const aspects = o.aspect ? [o.aspect] : !spec.aspects || spec.aspects === "all" ? ASPECTS.map(a => a.key) : spec.aspects;
    const empty = aspects.filter(a => grade([], key, { aspects: [a] }).total === 0);
    if (empty.length) throw new Error(`No key entry of ${spec.name} is in scope for ${empty.join(", ")}: nothing to measure.`);
    const prepared = await prepareFixture(
        { name: spec.name, url: spec.url ?? fixturePath(spec), sha: spec.sha, rules: spec.rules ? STRIP_RULES[spec.rules] : NO_RULES },
        deps.workspaceDir
    );
    const problems = keyProblems(key, prepared.path, prepared.preparedSha);
    if (problems.length) throw new Error(`The key does not fit the prepared tree:\n${problems.join("\n")}`);
    const root = resolve(import.meta.dirname, "..");
    const auditdesk = {
        commit: await git(["rev-parse", "HEAD"], root),
        dirty: (await git(["status", "--porcelain", "--", ".", ":!evals/results"], root)) !== ""
    };

    const now = deps.now ?? (() => new Date());
    const startedAt = now();
    const started = performance.now();
    const sink = new EvalSink();
    let aborted: string | null = null;
    try {
        await runAudit(
            {
                runId: `eval-${startedAt.toISOString().replace(/[:.]/g, "-")}`,
                projectId: `eval-${spec.name}`,
                model: o.model,
                effort: o.effort,
                budget: { usd: o.budgetUsd, tokens: o.budgetTokens },
                repositories: [{ id: spec.name, source: prepared.path, branch: "main", sha: prepared.preparedSha }],
                brief: { product: null, concerns: null, outOfScope: null, aiBuilt: spec.aiBuilt ?? false },
                aspects
            },
            {
                sink,
                runAspect: deps.runAspect,
                scanners: deps.scanners,
                fetchRulesets: deps.fetchRulesets,
                workspaceDir: deps.workspaceDir,
                checklistsDir: "checklists"
            }
        );
    } catch (e) {
        aborted = e instanceof Error ? e.message : String(e);
    }
    const durationMs = performance.now() - started;

    const findings: GradedFinding[] = sink.findings.map(f => ({
        label: f.label,
        kind: f.kind,
        source: f.source,
        aspect: f.aspect,
        checklistItem: f.checklistItem,
        title: f.title,
        summary: f.summary,
        evidence: f.evidence
    }));
    const g = grade(findings, key, { aspects });

    const byModel = new Map<string, { model: string; calls: number; usd: number; unpriced: number }>();
    let cacheRead = 0;
    let inputSide = 0;
    for (const c of sink.calls) {
        const row = byModel.get(c.servedModel) ?? { model: c.servedModel, calls: 0, usd: 0, unpriced: 0 };
        row.calls++;
        if (c.costUsd === null) row.unpriced++;
        else row.usd += c.costUsd;
        byModel.set(c.servedModel, row);
        cacheRead += c.usage.cacheRead;
        inputSide += c.usage.input + c.usage.cacheRead + c.usage.cacheWrite5m + c.usage.cacheWrite1h;
    }
    const agents = aspects.map(aspect => {
        const ran = sink.agents.find(a => a.aspect === aspect);
        if (ran) {
            const o = ran.outcome;
            if (!o) return { aspect, status: "failed" as const, note: "Did not finish." };
            const n = (status: string) => o.coverage.filter(c => c.status === status).length;
            const coverage = {
                examined: n("examined"),
                partly: n("partly"),
                notExamined: n("not_examined"),
                notReported: n("not_reported")
            };
            return { aspect, status: o.status, note: o.note, summary: o.summary, coverage };
        }
        const skipped = sink.events.find(m => m.startsWith(`Skipped ${aspectTitle(aspect)}:`));
        return {
            aspect,
            status: "not started" as const,
            note: skipped ?? (aborted ? `The audit was aborted before it: ${aborted}` : "The audit stopped before it.")
        };
    });

    const result: EvalResult = {
        fixture: spec.name,
        upstreamSha: prepared.upstreamSha,
        preparedSha: prepared.preparedSha,
        model: o.model,
        effort: o.effort,
        access: o.access,
        aspects,
        budget: { usd: o.budgetUsd, tokens: o.budgetTokens },
        startedAt,
        durationMs,
        auditdesk,
        keyDigest: createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 12),
        pricesAsOf: PRICES_AS_OF,
        aborted,
        grade: g,
        entries: key.entries,
        findings,
        falseFindings: spec.falseFindings ?? false,
        verdicts: null,
        judge: null,
        byModel: [...byModel.values()],
        cacheReadShare: inputSide ? cacheRead / inputSide : 0,
        agents,
        versions: sink.versions,
        removedImports: prepared.removedImports
    };

    await mkdir(deps.resultsDir, { recursive: true });
    const base = [startedAt.toISOString().slice(0, 10), spec.name, ...(o.aspect ? [o.aspect] : []), o.model, o.effort].join("-");
    let file = join(deps.resultsDir, `${base}.md`);
    for (let n = 2; existsSync(file); n++) file = join(deps.resultsDir, `${base}-${n}.md`);
    // Written before the judge runs, so a judge that fails cannot lose the audit's result.
    await writeFile(file, summaryMarkdown(result));

    if (o.judge && deps.judge && !aborted) {
        const placed = new Set([...g.leftovers, ...g.locationOnly.map(l => l.finding)]);
        const located = new Map<string, string[]>();
        for (const l of g.locationOnly) located.set(l.finding, [...(located.get(l.finding) ?? []), l.key]);
        const judged = await judgeLeftovers(
            deps.judge,
            findings.filter(f => placed.has(f.label)),
            key,
            { located, capUsd: o.judgeUsd }
        );
        result.verdicts = judged.verdicts;
        result.judge = { usd: judged.costUsd, unpriced: judged.unpriced, stopped: judged.stopped };
        await writeFile(file, summaryMarkdown(result));
    }
    return { file, result };
}

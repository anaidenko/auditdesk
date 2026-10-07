import type Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_EFFORT, DEFAULT_MODEL, type Effort } from "@/engine/agent/request";
import type { AgentOutcome, AspectRunner } from "@/engine/agent/run-aspect";
import { ASPECTS } from "@/engine/aspects";
import { MemorySink } from "@/engine/memory-sink";
import { EFFORTS, MODEL_CHOICES } from "@/engine/models";
import { type PipelineSink, runAudit } from "@/engine/pipeline";
import type { Ruleset, ScannerRunner, ToolVersions } from "@/engine/scanners/types";
import type { ModelAccess } from "@/engine/types";

import { type AnswerKey, type FixtureSpec, fixturePath, loadFixtures, loadKey } from "./fixtures";
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
    "pnpm eval --fixture <name> --access api_key|claude_plan --budget-usd <dollars> [--budget-tokens <n>] [--aspect <key>] [--model <id>] [--effort <level>] [--judge]";

export function parseEvalArgs(argv: string[]): { ok: true; value: EvalOptions } | { ok: false; error: string } {
    const flags = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) return { ok: false, error: `Unexpected argument ${a}. ${USAGE}` };
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
            judge: flags.get("--judge") === true
        }
    };
}

class EvalSink extends MemorySink implements PipelineSink {
    agents: { id: string; aspect: string; status: AgentOutcome["status"]; note: string | null }[] = [];
    versions: ToolVersions | null = null;
    async repositoryCloned() {}
    async stackDetected() {}
    async toolVersions(v: ToolVersions) {
        this.versions = v;
    }
    async startAgent(_repositoryId: string, aspect: string) {
        const id = `agent-${this.agents.length + 1}`;
        this.agents.push({ id, aspect, status: "failed", note: "did not finish" });
        return id;
    }
    async finishAgent(id: string, outcome: AgentOutcome) {
        Object.assign(
            this.agents.find(a => a.id === id)!,
            { status: outcome.status, note: outcome.note }
        );
    }
    async supersedeUnreviewed() {}
}

/**
 * One eval run (design § 5, § 11): prepares the fixture at its pinned commit, runs the audit bare
 * with an in-memory sink, grades the findings against the key, and writes the result file.
 */
export async function runEval(o: EvalOptions, deps: EvalDeps): Promise<{ file: string; result: EvalResult }> {
    const spec = (deps.fixtures ?? loadFixtures()).find(f => f.name === o.fixture);
    if (!spec) throw new Error(`No fixture named ${o.fixture} in evals/fixtures.yaml`);
    const key = (deps.loadKey ?? loadKey)(spec.name);
    const prepared = await prepareFixture(
        { name: spec.name, url: spec.url ?? fixturePath(spec), sha: spec.sha, rules: spec.rules ? STRIP_RULES[spec.rules] : NO_RULES },
        deps.workspaceDir
    );
    const aspects = o.aspect ? [o.aspect] : !spec.aspects || spec.aspects === "all" ? ASPECTS.map(a => a.key) : spec.aspects;
    const now = deps.now ?? (() => new Date());
    const startedAt = now();
    const started = performance.now();
    const sink = new EvalSink();
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
    const durationMs = performance.now() - started;

    const findings: GradedFinding[] = sink.findings.map(f => ({
        label: f.label,
        kind: f.kind,
        aspect: f.aspect,
        checklistItem: f.checklistItem,
        title: f.title,
        summary: f.summary,
        evidence: f.evidence
    }));
    const g = grade(findings, key, { aspects });
    const judged =
        o.judge && deps.judge
            ? await judgeLeftovers(
                  deps.judge,
                  findings.filter(f => g.leftovers.includes(f.label)),
                  key
              )
            : null;

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
        grade: g,
        entries: key.entries,
        findings,
        falseFindings: spec.falseFindings ?? false,
        verdicts: judged?.verdicts ?? null,
        byModel: [...byModel.values()],
        judgeUsd: judged ? judged.costUsd : null,
        cacheReadShare: inputSide ? cacheRead / inputSide : 0,
        agents: sink.agents.map(({ aspect, status, note }) => ({ aspect, status, note })),
        versions: sink.versions
    };

    await mkdir(deps.resultsDir, { recursive: true });
    const base = [startedAt.toISOString().slice(0, 10), spec.name, ...(o.aspect ? [o.aspect] : []), o.model, o.effort].join("-");
    let file = join(deps.resultsDir, `${base}.md`);
    for (let n = 2; existsSync(file); n++) file = join(deps.resultsDir, `${base}-${n}.md`);
    await writeFile(file, summaryMarkdown(result));
    return { file, result };
}

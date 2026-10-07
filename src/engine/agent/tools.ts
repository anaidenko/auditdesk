import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { Checklist } from "../checklists";
import { limitedReview } from "../coverage";
import { grepFiles, listFiles, readFileRange, snippetOf } from "../files";
import { fingerprint } from "../findings";
import type { Masker } from "../masker";
import { ToolError, resolveInClone } from "../paths";
import type { AuditSink, NewFinding } from "../types";

/** "not_reported" is the engine's: the agent stopped before finish_aspect, so what it read is unknown. */
export type Coverage = { item: string; status: "examined" | "partly" | "not_examined" | "not_reported" };

export interface AgentContext {
    clonePath: string;
    repositoryId: string;
    agentRunId: string;
    aspect: string;
    checklist: Checklist;
    masker: Masker;
    repoMap: string;
    sink: AuditSink;
    /** The agent's budget share; the engines set it from their input. */
    share?: { usd: number; tokens: number };
    state: {
        finished: { summary: string; coverage: Coverage[] } | null;
        reported: string[];
        fatal: Error | null;
        /** How many times finish_aspect sent the agent back to unexamined items, and what it reported then. */
        sentBack?: number;
        sentBackFinish?: { summary: string; coverage: Coverage[]; reads: number };
        /** Read-only tool calls so far: a send-back's second finish must follow at least one. */
        reads?: number;
        /** Why a finish was limited, for the outcome's note. */
        note?: string;
    };
}

/**
 * Coverage decides when an agent is done, not the model: one that finishes with a limited review is
 * sent back to the items it skipped, and again while each round examines more and items are left,
 * up to ROUNDS times and only while its share has room; each round names at most BATCH items.
 */
export const ROUNDS = 3;
export const BATCH = 5;

/** A ToolError goes back to the model as its tool result; any other error is a bug and ends the run. */
function guard<A>(ctx: AgentContext, fn: (args: A) => Promise<string>): (args: A) => Promise<string> {
    return async args => {
        try {
            return ctx.masker.mask(await fn(args));
        } catch (e) {
            if (e instanceof ToolError) throw e;
            ctx.state.fatal = e as Error;
            throw new ToolError("Internal error in the tool; the run is stopping.");
        }
    };
}

/**
 * Strict tool use accepts a subset of JSON Schema (claude-api skill, JSON Schema Limitations), and
 * `betaZodTool` sends Zod's output as is. Zod's `$schema` and the safe-integer bounds `.int()` adds
 * go; the SDK's own transform moves anything else unsupported into the description. The runner still
 * validates the input with the Zod schema.
 */
function strictSchema<S extends object>(schema: S): S {
    const prune = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(prune);
        if (!v || typeof v !== "object") return v;
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
            if (k === "$schema" || ((k === "minimum" || k === "maximum") && Math.abs(Number(x)) === Number.MAX_SAFE_INTEGER)) continue;
            out[k] = prune(x);
        }
        return out;
    };
    return transformJSONSchema(prune(schema) as Record<string, unknown>) as S;
}

const findingInput = z.strictObject({
    kind: z.enum(["finding", "question"]),
    checklist_item: z.string().describe("The checklist item this belongs to, such as SEC-04."),
    title: z.string().describe("At most 12 words."),
    severity: z.enum(["critical", "high", "medium", "low", "info", "none"]).describe('"none" for a question.'),
    likelihood: z.string(),
    impact: z.string(),
    summary: z.string().describe("For a non-technical founder."),
    explanation: z.string().describe("For the client's engineers."),
    recommendation: z.string(),
    effort: z.enum(["S", "M", "L"]).describe("S: under 2 hours. M: under 2 days. L: more."),
    evidence: z.array(z.strictObject({ file: z.string(), start_line: z.number().int(), end_line: z.number().int() })),
    cwe: z.string().describe("A CWE ID such as CWE-89, or an empty string."),
    tags: z.array(z.string())
});

const finishInput = z.strictObject({
    summary: z.string(),
    coverage: z.array(z.strictObject({ item: z.string(), status: z.enum(["examined", "partly", "not_examined"]) }))
});

/** One tool as both engines declare it: through betaZodTool on the API, through an MCP server on the SDK. */
export interface ToolSpec {
    name: string;
    description: string;
    inputSchema: z.ZodObject;
    /** No side effect: the SDK may run it beside other read-only calls. */
    readOnly: boolean;
    // `never`: each spec takes its own schema's output, and the engines pass what that schema parsed.
    run: (args: never) => Promise<string>;
}

const spec = <S extends z.ZodObject>(s: {
    name: string;
    description: string;
    inputSchema: S;
    readOnly: boolean;
    run: (args: z.infer<S>) => Promise<string>;
}): ToolSpec => s;

/** The same seven tools for every aspect, declared from the first request: the cached prefix starts with them (design § 8). */
export function toolSpecs(ctx: AgentContext): ToolSpec[] {
    const counted = (s: ToolSpec): ToolSpec =>
        s.readOnly
            ? {
                  ...s,
                  run: (args: never) => {
                      ctx.state.reads = (ctx.state.reads ?? 0) + 1;
                      return s.run(args);
                  }
              }
            : s;
    return [
        spec({
            name: "list_files",
            description:
                "List files under a directory of the repository, with sizes. Dependency and build folders are skipped; symlinks are listed, not followed.",
            inputSchema: z.strictObject({
                dir: z.string().describe('"." for the root.'),
                glob: z.string().describe('Such as "**/*.ts", or an empty string.')
            }),
            readOnly: true,
            run: guard(ctx, async ({ dir, glob }) => listFiles(ctx.clonePath, { dir, glob: glob || undefined }))
        }),
        spec({
            name: "read_file",
            description: "Read a line range of a file, with line numbers. At most 400 lines per call.",
            inputSchema: z.strictObject({ path: z.string(), start_line: z.number().int(), end_line: z.number().int() }),
            readOnly: true,
            run: guard(ctx, async ({ path, start_line, end_line }) =>
                readFileRange(ctx.clonePath, path, start_line, end_line, line => ctx.masker.mask(line))
            )
        }),
        spec({
            name: "grep",
            description: "Search the repository with a JavaScript regular expression. At most 200 matches.",
            inputSchema: z.strictObject({
                pattern: z.string(),
                glob: z.string().describe("Limits the files searched, or an empty string.")
            }),
            readOnly: true,
            run: guard(ctx, async ({ pattern, glob }) =>
                grepFiles(ctx.clonePath, pattern, { glob: glob || undefined, mask: line => ctx.masker.mask(line) })
            )
        }),
        spec({
            name: "repo_map",
            description: "The repository map again: entry points, routes, data schema, environment variables, tests.",
            inputSchema: z.strictObject({}),
            readOnly: true,
            run: guard(ctx, async () => ctx.repoMap)
        }),
        spec({
            name: "scanner_results",
            description: "The findings gitleaks, osv-scanner and Semgrep filed for an aspect of this repository, with their IDs.",
            inputSchema: z.strictObject({ aspect: z.string().describe("Such as security or dependencies.") }),
            readOnly: true,
            run: guard(ctx, async ({ aspect }) => {
                const rows = await ctx.sink.findingIndex(ctx.repositoryId, { source: "scanner", aspect });
                return rows.length ? rows.join("\n") : `No scanner findings for ${aspect}.`;
            })
        }),
        spec({
            name: "report_finding",
            description: "File one confirmed finding or question. Evidence lines must exist; the snippet is taken from the file.",
            inputSchema: findingInput,
            readOnly: false,
            run: guard(ctx, async input => reportFinding(ctx, input))
        }),
        spec({
            name: "finish_aspect",
            description: "End this aspect with a summary and the coverage of every checklist item.",
            inputSchema: finishInput,
            readOnly: false,
            run: guard(ctx, async input => finishAspect(ctx, input))
        })
    ].map(counted);
}

/** The API engine's declaration: strict tools on the SDK's tool runner. */
export function makeTools(ctx: AgentContext) {
    const strict = <T extends object>(tool: T): T & { strict: true } => ({
        ...tool,
        ...("input_schema" in tool ? { input_schema: strictSchema(tool.input_schema as object) } : {}),
        strict: true as const
    });
    return toolSpecs(ctx).map(s =>
        strict(betaZodTool({ name: s.name, description: s.description, inputSchema: s.inputSchema, run: args => s.run(args as never) }))
    );
}

async function reportFinding(ctx: AgentContext, input: z.infer<typeof findingInput>): Promise<string> {
    const ids = ctx.checklist.items.map(i => i.id);
    if (!ids.includes(input.checklist_item))
        throw new ToolError(`Unknown checklist item ${input.checklist_item}; use one of ${ids.join(", ")}.`);
    if (input.kind === "finding" && input.severity === "none") throw new ToolError('A finding needs a severity; "none" is for questions.');
    if (input.kind === "finding" && !input.evidence.length) throw new ToolError("A finding needs at least one evidence range.");
    if (input.evidence.length > 5) throw new ToolError("At most five evidence ranges; file the rest as a separate finding.");

    const evidence = [];
    for (const e of input.evidence) {
        const { abs, rel } = await resolveInClone(ctx.clonePath, e.file);
        const text = await readFile(abs, "utf8").catch(() => {
            throw new ToolError(`${rel} is a directory or unreadable; evidence must name a file.`);
        });
        const lines = text.split(/\r?\n/);
        if (e.start_line < 1 || e.end_line < e.start_line || e.end_line > lines.length)
            throw new ToolError(`${rel} has ${lines.length} lines; ${e.start_line}-${e.end_line} is not a valid range.`);
        const snippet = snippetOf(lines, e.start_line, e.end_line, line => ctx.masker.mask(line));
        evidence.push({ file: rel, startLine: e.start_line, endLine: e.end_line, snippet });
    }
    const base = { repositoryId: ctx.repositoryId, aspect: ctx.aspect, checklistItem: input.checklist_item, evidence };
    const finding: NewFinding = ctx.masker.maskDeep({
        ...base,
        agentRunId: ctx.agentRunId,
        kind: input.kind,
        title: input.title,
        severity: input.kind === "question" || input.severity === "none" ? null : input.severity,
        likelihood: input.likelihood || null,
        impact: input.impact || null,
        summary: input.summary,
        explanation: input.explanation,
        recommendation: input.recommendation,
        effort: input.effort,
        references: input.cwe ? { cwe: input.cwe } : {},
        // The engine alone decides "ai-built", by the item: a model's own tag would put any finding in that section.
        tags: [
            ...new Set(input.tags.filter(t => t !== "ai-built")),
            ...(ctx.checklist.items.find(i => i.id === input.checklist_item)?.aiBuilt ? ["ai-built"] : [])
        ],
        source: "agent",
        fingerprint: fingerprint(base)
    });
    const label = await ctx.sink.createFinding(finding);
    ctx.state.reported.push(label);
    return `Filed ${label}.`;
}

async function finishAspect(ctx: AgentContext, input: z.infer<typeof finishInput>): Promise<string> {
    const ids = ctx.checklist.items.map(i => i.id);
    const unknown = input.coverage.filter(c => !ids.includes(c.item)).map(c => c.item);
    if (unknown.length) throw new ToolError(`Not on this checklist: ${unknown.join(", ")}.`);
    let coverage: Coverage[] = ids.map(id => input.coverage.find(c => c.item === id) ?? { item: id, status: "not_examined" });
    const last = ctx.state.sentBackFinish;
    const rounds = ctx.state.sentBack ?? 0;
    // Coverage is self-reported: statuses raised after a send-back without one more read do not count.
    const rank = (c: Coverage) => ({ examined: 2, partly: 1 })[c.status as "examined" | "partly"] ?? 0;
    const raised = (a: Coverage[], b: Coverage[]) => a.some((c, i) => rank(c) > rank(b[i]));
    if (last && (ctx.state.reads ?? 0) === last.reads && raised(coverage, last.coverage)) {
        coverage = last.coverage;
        ctx.state.note = "Sent back; it changed its coverage without reading more code, so its earlier coverage stands.";
    }
    const left = coverage.filter(c => c.status === "not_examined").map(c => c.item);
    // The first round is for a limited review; later ones go on while a round examined more and items are left.
    const due = rounds === 0 ? limitedReview(coverage) : left.length > 0 && !!last && raised(coverage, last.coverage);
    if (due && ctx.share && rounds < ROUNDS) {
        const spend = await ctx.sink.agentSpend(ctx.agentRunId);
        if (!spend.unpriced && spend.usd * 2 < ctx.share.usd && spend.freshTokens * 2 < ctx.share.tokens) {
            ctx.state.sentBack = rounds + 1;
            // Kept, so an agent that never finishes again still reports what it said here.
            ctx.state.sentBackFinish = { summary: input.summary, coverage, reads: ctx.state.reads ?? 0 };
            await ctx.sink.progress(`${ctx.checklist.title}: sent back to ${left.length} unexamined items of ${ids.length}.`, "warn");
            const next = left.slice(0, BATCH).map(id => `${id} ${ctx.checklist.items.find(i => i.id === id)!.title}`);
            const more = left.length > BATCH ? ` (${left.length - BATCH} more after them)` : "";
            return `Not finished: ${left.length} of ${ids.length} items are not examined. Examine these next: ${next.join(", ")}${more}. Read the code they concern, file what you find, then call finish_aspect again with the updated coverage. Mark an item examined or partly only for code you read for it.`;
        }
        if (rounds === 0) ctx.state.note ??= `${left.length} of ${ids.length} items not examined; half of its share was already spent.`;
    }
    if (rounds > 0 && left.length && (limitedReview(coverage) || rounds >= ROUNDS))
        ctx.state.note ??= `Sent back ${rounds === 1 ? "once" : `${rounds} times`}; ${left.length} of ${ids.length} items still not examined.`;
    ctx.state.finished = { summary: input.summary, coverage };
    return "Aspect finished.";
}

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { Checklist } from "../checklists";
import { grepFiles, listFiles, readFileRange } from "../files";
import { fingerprint } from "../findings";
import type { Masker } from "../masker";
import { ToolError, resolveInClone } from "../paths";
import type { AuditSink, NewFinding } from "../types";

export type Coverage = { item: string; status: "examined" | "partly" | "not_examined" };

export interface AgentContext {
    clonePath: string;
    repositoryId: string;
    agentRunId: string;
    aspect: string;
    checklist: Checklist;
    masker: Masker;
    repoMap: string;
    sink: AuditSink;
    state: { finished: { summary: string; coverage: Coverage[] } | null; reported: string[]; fatal: Error | null };
}

const SNIPPET_LINES = 30;

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

/** The same seven tools for every aspect, declared from the first request: the cached prefix starts with them (design § 8). */
export function makeTools(ctx: AgentContext) {
    const strict = <T extends object>(tool: T): T & { strict: true } => ({
        ...tool,
        ...("input_schema" in tool ? { input_schema: strictSchema(tool.input_schema as object) } : {}),
        strict: true as const
    });
    return [
        strict(
            betaZodTool({
                name: "list_files",
                description:
                    "List files under a directory of the repository, with sizes. Dependency and build folders are skipped; symlinks are listed, not followed.",
                inputSchema: z.strictObject({
                    dir: z.string().describe('"." for the root.'),
                    glob: z.string().describe('Such as "**/*.ts", or an empty string.')
                }),
                run: guard(ctx, async ({ dir, glob }) => listFiles(ctx.clonePath, { dir, glob: glob || undefined }))
            })
        ),
        strict(
            betaZodTool({
                name: "read_file",
                description: "Read a line range of a file, with line numbers. At most 400 lines per call.",
                inputSchema: z.strictObject({ path: z.string(), start_line: z.number().int(), end_line: z.number().int() }),
                run: guard(ctx, async ({ path, start_line, end_line }) => readFileRange(ctx.clonePath, path, start_line, end_line))
            })
        ),
        strict(
            betaZodTool({
                name: "grep",
                description: "Search the repository with a JavaScript regular expression. At most 200 matches.",
                inputSchema: z.strictObject({
                    pattern: z.string(),
                    glob: z.string().describe("Limits the files searched, or an empty string.")
                }),
                run: guard(ctx, async ({ pattern, glob }) => grepFiles(ctx.clonePath, pattern, { glob: glob || undefined }))
            })
        ),
        strict(
            betaZodTool({
                name: "repo_map",
                description: "The repository map again: entry points, routes, data schema, environment variables, tests.",
                inputSchema: z.strictObject({}),
                run: guard(ctx, async () => ctx.repoMap)
            })
        ),
        strict(
            betaZodTool({
                name: "scanner_results",
                description: "The findings gitleaks, osv-scanner and Semgrep filed for an aspect of this repository, with their IDs.",
                inputSchema: z.strictObject({ aspect: z.string().describe("Such as security or dependencies.") }),
                run: guard(ctx, async ({ aspect }) => {
                    const rows = await ctx.sink.findingIndex(ctx.repositoryId, { source: "scanner", aspect });
                    return rows.length ? rows.join("\n") : `No scanner findings for ${aspect}.`;
                })
            })
        ),
        strict(
            betaZodTool({
                name: "report_finding",
                description: "File one confirmed finding or question. Evidence lines must exist; the snippet is taken from the file.",
                inputSchema: findingInput,
                run: guard(ctx, async input => reportFinding(ctx, input))
            })
        ),
        strict(
            betaZodTool({
                name: "finish_aspect",
                description: "End this aspect with a summary and the coverage of every checklist item.",
                inputSchema: finishInput,
                run: guard(ctx, async input => finishAspect(ctx, input))
            })
        )
    ];
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
        const snippet = lines.slice(e.start_line - 1, Math.min(e.end_line, e.start_line + SNIPPET_LINES - 1)).join("\n");
        evidence.push({ file: rel, startLine: e.start_line, endLine: e.end_line, snippet: ctx.masker.mask(snippet) });
    }
    const base = { repositoryId: ctx.repositoryId, aspect: ctx.aspect, checklistItem: input.checklist_item, evidence };
    const finding: NewFinding = ctx.masker.maskDeep({
        ...base,
        agentRunId: ctx.agentRunId,
        kind: input.kind,
        title: input.title,
        severity: input.severity === "none" ? null : input.severity,
        likelihood: input.likelihood || null,
        impact: input.impact || null,
        summary: input.summary,
        explanation: input.explanation,
        recommendation: input.recommendation,
        effort: input.effort,
        references: input.cwe ? { cwe: input.cwe } : {},
        tags: input.tags,
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
    const coverage: Coverage[] = ids.map(id => input.coverage.find(c => c.item === id) ?? { item: id, status: "not_examined" });
    ctx.state.finished = { summary: input.summary, coverage };
    return "Aspect finished.";
}

import { describe, expect, it } from "vitest";

import { parseChecklist } from "../checklists";
import { Masker } from "../masker";
import { MemorySink } from "../memory-sink";
import { prefixBlocks } from "../prompts";

import { agentParams } from "./request";
import { makeTools } from "./tools";

function paramsFor(aspect: string, prefix: string) {
    const checklist = parseChecklist(aspect, `# ${aspect}\n\n## ${prefix}-01 Item\n`);
    const ctx = {
        clonePath: "/tmp",
        repositoryId: "r",
        agentRunId: aspect,
        aspect,
        checklist,
        masker: new Masker([]),
        repoMap: "map",
        sink: new MemorySink(),
        state: { finished: null, reported: [], fatal: null }
    };
    return agentParams({
        model: "claude-opus-5-5",
        effort: "medium",
        system: prefixBlocks({ stackProfile: "s", repoMap: "map", brief: "b" }),
        tools: makeTools(ctx),
        messages: [{ role: "user", content: `checklist for ${aspect}` }],
        taskBudget: 50000,
        maxIterations: 60
    });
}

describe("agentParams", () => {
    it("sends a byte-identical tools-and-system prefix for every aspect", () => {
        const strip = (p: ReturnType<typeof paramsFor>) =>
            JSON.stringify({ tools: p.tools.map(({ run: _r, ...t }) => t), system: p.system });
        expect(strip(paramsFor("security", "SEC"))).toBe(strip(paramsFor("architecture", "ARC")));
    });

    it("sends effort explicitly, since Opus 5.5 defaults to medium where Opus 5 defaulted to high", () => {
        expect(paramsFor("security", "SEC").output_config.effort).toBe("medium");
    });

    it("sends strict schemas without the keywords strict tool use rejects", () => {
        const schemas = JSON.stringify(paramsFor("security", "SEC").tools.map(t => ("input_schema" in t ? t.input_schema : null)));
        // claude-api skill, JSON Schema Limitations: no numerical constraints; Zod's .int() adds safe-integer bounds.
        expect(schemas).not.toMatch(/"(minimum|maximum|\$schema)"/);
        expect(schemas).not.toMatch(/9007199254740991/);
    });

    it("never forces a tool, which Opus 5.5 answers with a 400", () => {
        expect(paramsFor("security", "SEC").tool_choice).toEqual({ type: "auto" });
    });
});

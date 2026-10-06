import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { parseChecklist } from "../checklists";
import { Masker } from "../masker";
import { MemorySink } from "../memory-sink";

import { makeSdkServer, sdkToolName } from "./tools";

async function ctx() {
    return {
        clonePath: await makeRepo({ "a.txt": "token=SECRET123\n" }),
        repositoryId: "r",
        agentRunId: "a",
        aspect: "security",
        checklist: parseChecklist("security", "# Security\n\n## SEC-01 Item\n"),
        masker: new Masker([{ value: "SECRET123", rule: "generic-api-key" }]),
        repoMap: "",
        sink: new MemorySink(),
        state: { finished: null, reported: [], fatal: null }
    };
}

type Result = { content: { text: string }[]; isError?: boolean };
const handler = (tools: ReturnType<typeof makeSdkServer>["tools"], name: string) => {
    const t = tools.find(x => x.name === name)!;
    return (args: unknown) => t.handler(args as never, {}) as Promise<Result>;
};

describe("makeSdkServer", () => {
    it("serves the seven tools under the auditdesk prefix", async () => {
        const { names } = makeSdkServer(await ctx());
        expect(names).toEqual(
            ["list_files", "read_file", "grep", "repo_map", "scanner_results", "report_finding", "finish_aspect"].map(sdkToolName)
        );
    });

    it("returns masked text, and a tool error as an error result the model reads", async () => {
        const c = await ctx();
        const failed: string[] = [];
        const read = handler(makeSdkServer(c, { onToolError: name => void failed.push(name) }).tools, "read_file");
        expect((await read({ path: "a.txt", start_line: 1, end_line: 1 })).content[0].text).not.toContain("SECRET123");
        const outside = await read({ path: "../etc/passwd", start_line: 1, end_line: 1 });
        expect(outside.isError).toBe(true);
        expect(failed).toEqual(["read_file"]);
        expect(c.state.fatal).toBeNull();
    });

    it("marks the read-only tools so", async () => {
        const { tools } = makeSdkServer(await ctx());
        expect(tools.filter(t => t.annotations?.readOnlyHint).map(t => t.name)).toEqual([
            "list_files",
            "read_file",
            "grep",
            "repo_map",
            "scanner_results"
        ]);
    });

    // The CLI ends the turn on a successful result whose _meta carries the marker (Task E.1, Deviation 4).
    it("ends the turn only on a successful finish_aspect", async () => {
        const c = await ctx();
        const { tools } = makeSdkServer(c);
        const finish = (coverage: { item: string; status: string }[]) =>
            handler(tools, "finish_aspect")({ summary: "s", coverage }) as Promise<Result & { _meta?: Record<string, unknown> }>;
        const failed = await finish([{ item: "SEC-99", status: "examined" }]);
        expect(failed.isError).toBe(true);
        expect(failed._meta).toBeUndefined();
        expect((await finish([{ item: "SEC-01", status: "examined" }]))._meta).toEqual({ "claude/endTurn": true });
        expect(((await handler(tools, "repo_map")({})) as { _meta?: unknown })._meta).toBeUndefined();
    });
});

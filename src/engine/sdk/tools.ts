import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

import { type AgentContext, toolSpecs } from "../agent/tools";
import { ToolError } from "../paths";

export const SERVER = "auditdesk";
export const sdkToolName = (name: string) => `mcp__${SERVER}__${name}`;

/** A successful finish ends the turn without another request. The CLI reads it from a result's _meta, not the tool's definition. */
const END_TURN = { "claude/endTurn": true };

/**
 * The seven tools of `toolSpecs`, in-process. Always loaded: the session has no ToolSearch tool
 * (`tools: []`) to fetch a deferred one. There is no `strict` on this path; the MCP server parses
 * each input with the same Zod schema before the handler runs.
 */
export function makeSdkServer(ctx: AgentContext, o: { onToolError?: (name: string) => void } = {}) {
    const specs = toolSpecs(ctx);
    const tools = specs.map(s =>
        tool(
            s.name,
            s.description,
            s.inputSchema.shape,
            async args => {
                try {
                    const text = await s.run(args as never);
                    return { content: [{ type: "text" as const, text }], ...(s.name === "finish_aspect" ? { _meta: END_TURN } : {}) };
                } catch (e) {
                    o.onToolError?.(s.name);
                    // guard() already turned any other error into a ToolError and recorded it as fatal.
                    const text = e instanceof ToolError ? e.message : "Internal error in the tool; the run is stopping.";
                    return { content: [{ type: "text" as const, text }], isError: true };
                }
            },
            { annotations: { readOnlyHint: s.readOnly } }
        )
    );
    const server = createSdkMcpServer({ name: SERVER, version: "1.0.0", alwaysLoad: true, tools });
    return { server, tools, names: specs.map(s => sdkToolName(s.name)) };
}

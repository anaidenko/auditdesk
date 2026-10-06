import type { McpSdkServerConfigWithInstance, Options } from "@anthropic-ai/claude-agent-sdk";

import type { Effort } from "../agent/request";
import { CREDENTIAL_ENV } from "../credentials";
import type { ModelAccess } from "../types";

import { SERVER } from "./tools";

/**
 * The subprocess's whole environment: `env` replaces process.env, so nothing of the app's reaches
 * it. Exactly one credential: in Claude Code's precedence an API key outranks the plan token, and
 * with neither it falls back to the Keychain login (code.claude.com, Authentication).
 */
export function sdkEnv(o: {
    access: ModelAccess;
    credential: string;
    configDir: string;
    baseUrl?: string;
    extra?: Record<string, string>;
}): Record<string, string> {
    return {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        [CREDENTIAL_ENV[o.access]]: o.credential,
        // Its own config directory: no user settings, no Keychain entry, no transcript under ~/.claude.
        CLAUDE_CONFIG_DIR: o.configDir,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        // A failed stream fails the call instead of being retried without streaming: the engine reads every call from the stream.
        CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1",
        CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
        CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
        // Tool search is on against api.anthropic.com and off against a loopback base URL, so tests alone would never see it.
        ENABLE_TOOL_SEARCH: "false",
        // As the API engine's maxRetries; tests pass 0 through `extra`.
        CLAUDE_CODE_MAX_RETRIES: "4",
        CLAUDE_AGENT_SDK_CLIENT_APP: "auditdesk/0.1.0",
        ...(o.baseUrl ? { ANTHROPIC_BASE_URL: o.baseUrl } : {}),
        ...o.extra
    };
}

/** Isolation (design § 12; Andrii, 2026-10-06): our seven tools and nothing the clone or the machine could add. */
export function sdkOptions(o: {
    model: string;
    effort: Effort;
    taskBudget: number;
    maxTurns: number;
    systemPrompt: string[];
    server: McpSdkServerConfigWithInstance;
    toolNames: string[];
    cwd: string;
    env: Record<string, string>;
    /** In-process callbacks (the engine's PostToolBatch check), not file settings. */
    hooks: Options["hooks"];
    stderr: (data: string) => void;
}): Options {
    return {
        model: o.model,
        effort: o.effort,
        thinking: { type: "adaptive", display: "omitted" },
        taskBudget: { total: o.taskBudget },
        maxTurns: o.maxTurns,
        systemPrompt: o.systemPrompt,
        mcpServers: { [SERVER]: o.server },
        tools: [],
        allowedTools: o.toolNames,
        permissionMode: "dontAsk",
        permissionPrompts: "none",
        settingSources: [],
        strictMcpConfig: true,
        plugins: [],
        skills: [],
        persistSession: false,
        includePartialMessages: true,
        verbatimPrompts: true,
        cwd: o.cwd,
        env: o.env,
        hooks: o.hooks,
        stderr: o.stderr
    };
}

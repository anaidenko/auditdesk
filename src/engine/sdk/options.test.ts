import { afterEach, describe, expect, it, vi } from "vitest";

import { sdkEnv, sdkOptions } from "./options";

afterEach(() => vi.unstubAllEnvs());

const env = (access: "claude_plan" | "api_key") => sdkEnv({ access, credential: "cred", configDir: "/tmp/cfg" });

describe("sdkEnv", () => {
    it("carries exactly one credential: the plan token on a Claude plan run, even with a key in .env.local", () => {
        vi.stubEnv("ANTHROPIC_API_KEY", "sk-from-env-local");
        const e = env("claude_plan");
        expect(e.CLAUDE_CODE_OAUTH_TOKEN).toBe("cred");
        expect("ANTHROPIC_API_KEY" in e).toBe(false);
        expect("ANTHROPIC_AUTH_TOKEN" in e).toBe(false);
    });

    it("carries the key and no plan token on an API key run", () => {
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "token-from-env-local");
        const e = env("api_key");
        expect(e.ANTHROPIC_API_KEY).toBe("cred");
        expect("CLAUDE_CODE_OAUTH_TOKEN" in e).toBe(false);
    });

    it("passes none of the app's own environment", () => {
        vi.stubEnv("DATABASE_URL", "postgresql://secret");
        vi.stubEnv("ANTHROPIC_PROFILE", "work");
        expect(Object.keys(env("claude_plan")).sort()).toEqual(
            [
                "CLAUDE_AGENT_SDK_CLIENT_APP",
                "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY",
                "CLAUDE_CODE_MAX_RETRIES",
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
                "CLAUDE_CODE_DISABLE_TERMINAL_TITLE",
                "CLAUDE_CODE_OAUTH_TOKEN",
                "CLAUDE_CONFIG_DIR",
                "DISABLE_ERROR_REPORTING",
                "DISABLE_TELEMETRY",
                "ENABLE_CLAUDEAI_MCP_SERVERS",
                "ENABLE_TOOL_SEARCH",
                "HOME",
                "PATH",
                "TMPDIR"
            ].sort()
        );
    });

    it("turns tool search, claude.ai connectors and nonessential traffic off", () => {
        const e = env("claude_plan");
        expect(e.ENABLE_TOOL_SEARCH).toBe("false");
        expect(e.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
        expect(e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
        expect(e.CLAUDE_CONFIG_DIR).toBe("/tmp/cfg");
        expect(e.CLAUDE_CODE_MAX_RETRIES).toBe("4");
    });
});

describe("sdkOptions", () => {
    it("isolates the session: no built-in tool, no file settings, no other server, no transcript", () => {
        const o = sdkOptions({
            model: "claude-sonnet-5-5",
            effort: "low",
            taskBudget: 50_000,
            maxTurns: 60,
            systemPrompt: ["s"],
            server: {} as never,
            toolNames: ["mcp__auditdesk__read_file"],
            cwd: "/tmp/cwd",
            env: {},
            hooks: {},
            stderr: () => {}
        });
        expect(o).toMatchObject({
            tools: [],
            allowedTools: ["mcp__auditdesk__read_file"],
            permissionMode: "dontAsk",
            permissionPrompts: "none",
            settingSources: [],
            strictMcpConfig: true,
            plugins: [],
            skills: [],
            persistSession: false,
            verbatimPrompts: true,
            includePartialMessages: true,
            model: "claude-sonnet-5-5",
            effort: "low",
            taskBudget: { total: 50_000 },
            maxTurns: 60,
            cwd: "/tmp/cwd"
        });
    });
});

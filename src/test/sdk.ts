import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type FakeReply, startFakeAnthropic } from "@/engine/sdk/fake-server";
import type { SdkRunnerConfig } from "@/engine/sdk/run-aspect-sdk";
import { SERVER } from "@/engine/sdk/tools";
import type { ModelAccess } from "@/engine/types";

import { startConnectSpy } from "./connect-spy";

/** A fake Messages API and a refusing proxy: a test whose subprocess reached the network sees it in `spy.attempts`. */
export async function sdkHarness(
    messages: BetaMessage[],
    o: { reply?: (n: number) => FakeReply | null; keepModel?: (n: number) => boolean } = {}
) {
    const fake = await startFakeAnthropic(messages, { toolPrefix: `mcp__${SERVER}__`, reply: o.reply, keepModel: o.keepModel });
    const spy = await startConnectSpy();
    const runDir = await mkdtemp(join(tmpdir(), "auditdesk-run-"));
    const config = (access: ModelAccess = "claude_plan"): SdkRunnerConfig => ({
        access,
        credential: access === "claude_plan" ? "test-plan-token" : "test-api-key",
        runDir,
        baseUrl: fake.url,
        // Test-only: no retry waits; anything not for the fake server goes to the spy.
        extraEnv: { CLAUDE_CODE_MAX_RETRIES: "0", HTTPS_PROXY: spy.url, HTTP_PROXY: spy.url, NO_PROXY: "127.0.0.1,localhost" }
    });
    return {
        fake,
        spy,
        runDir,
        config,
        close: async () => {
            await fake.close();
            await spy.close();
        }
    };
}
export type SdkHarness = Awaited<ReturnType<typeof sdkHarness>>;

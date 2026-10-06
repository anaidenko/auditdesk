// Two live requests that check what the replayed tests cannot: that the API accepts our exact
// request shape, streams usage.iterations, and serves the second request from the cache.
// .mts: tsx compiles a .ts file as CommonJS here (no "type": "module"), where top-level await fails.
// @next/env is CommonJS, so ESM gets only its default export.
import nextEnv from "@next/env";

import { DEFAULT_MODEL, agentParams } from "../src/engine/agent/request";
import { makeTools } from "../src/engine/agent/tools";
import { parseChecklist } from "../src/engine/checklists";
import { Masker } from "../src/engine/masker";
import { MemorySink } from "../src/engine/memory-sink";
import { createClient } from "../src/engine/model";
import { prefixBlocks } from "../src/engine/prompts";

nextEnv.loadEnvConfig(process.cwd());

const client = createClient();
const system = prefixBlocks({
    stackProfile: "TypeScript",
    repoMap: "# Repository map\n" + "src/index.ts (10 bytes)\n".repeat(150),
    brief: "Smoke test."
});
// The real tool definitions, so the API compiles our strict schemas; their run functions are never called.
const tools = makeTools({
    clonePath: process.cwd(),
    repositoryId: "smoke",
    agentRunId: "smoke",
    aspect: "security",
    checklist: parseChecklist("security", "# Security\n\n## SEC-01 Item\n"),
    masker: new Masker([]),
    repoMap: "",
    sink: new MemorySink(),
    state: { finished: null, reported: [], fatal: null }
});

for (const attempt of [1, 2]) {
    const params = agentParams({
        model: DEFAULT_MODEL,
        effort: "low",
        system,
        tools,
        messages: [{ role: "user", content: "This is a connectivity check. Do not call any tool; reply with the word ready." }],
        taskBudget: 20_000,
        maxIterations: 1
    });
    // Through the tool runner, as the agent sends it; max_iterations 1 makes it a single request.
    for await (const stream of client.beta.messages.toolRunner(params)) {
        const msg = await stream.finalMessage();
        console.log(attempt, msg.model, msg.stop_reason, JSON.stringify(msg.usage));
    }
}

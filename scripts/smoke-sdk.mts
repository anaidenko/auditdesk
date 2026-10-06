// One live request through the SDK engine: the plan token is accepted, the model and effort are served,
// and the call is recorded. .mts for top-level await, as scripts/smoke.mts.
import nextEnv from "@next/env";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_EFFORT, DEFAULT_MODEL } from "../src/engine/agent/request";
import { parseChecklist } from "../src/engine/checklists";
import { resolveCredential } from "../src/engine/credentials";
import { Masker } from "../src/engine/masker";
import { MemorySink } from "../src/engine/memory-sink";
import { prefixBlocks } from "../src/engine/prompts";
import { runAspectSdk } from "../src/engine/sdk/run-aspect-sdk";

nextEnv.loadEnvConfig(process.cwd());

const credential = await resolveCredential("claude_plan");
if (!credential) throw new Error("No Claude plan token in .env.local or Settings.");
const clonePath = await mkdtemp(join(tmpdir(), "auditdesk-smoke-"));
await writeFile(join(clonePath, "index.js"), "console.log('hello');\n");
const sink = new MemorySink();
const outcome = await runAspectSdk(
    { access: "claude_plan", credential, runDir: await mkdtemp(join(tmpdir(), "auditdesk-smoke-run-")) },
    {
        model: DEFAULT_MODEL,
        effort: DEFAULT_EFFORT,
        share: { usd: 0.2, tokens: 20_000 },
        maxIterations: 2,
        ctx: {
            clonePath,
            repositoryId: "smoke",
            agentRunId: "smoke",
            aspect: "security",
            checklist: parseChecklist("security", "# Security\n\n## SEC-01 Item\n"),
            masker: new Masker([]),
            repoMap: "",
            sink,
            state: { finished: null, reported: [], fatal: null }
        },
        system: prefixBlocks({ stackProfile: "JavaScript", repoMap: "# Repository map\nindex.js (22 bytes)\n", brief: "Smoke test." }),
        firstMessage: "This is a connectivity check. Call finish_aspect now with the summary 'ready' and SEC-01 not_examined."
    }
);
console.log(outcome.status, outcome.note);
for (const c of sink.calls) console.log(c.servedModel, c.stopReason, JSON.stringify(c.usage), c.costUsd);
console.log(sink.events.join("\n"));

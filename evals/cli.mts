// `pnpm eval`: one eval run against the live model (design § 5); its cost estimate waits for
// Andrii's OK like any other live run. .mts for top-level await, as scripts/smoke.mts.
import nextEnv from "@next/env";
import { join } from "node:path";

import { apiAspectRunner } from "../src/engine/agent/run-aspect";
import { workspaceDir } from "../src/engine/config";
import { resolveCredential } from "../src/engine/credentials";
import { createClient } from "../src/engine/model";
import { readPlanUsage, reserveRefusal } from "../src/engine/plan-usage";
import { dockerRunner } from "../src/engine/scanners/docker";
import { RULESETS, fetchRulesets } from "../src/engine/scanners/rulesets";
import { sdkAspectRunner } from "../src/engine/sdk/run-aspect-sdk";

import { parseEvalArgs, runEval } from "./run";

nextEnv.loadEnvConfig(process.cwd());

const parsed = parseEvalArgs(process.argv.slice(2));
if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(2);
}
const o = parsed.value;
const credential = await resolveCredential(o.access);
if (!credential) throw new Error(`No ${o.access === "api_key" ? "API key" : "Claude plan token"} in .env.local or Settings.`);
if (o.access === "claude_plan") {
    const refusal = reserveRefusal(await readPlanUsage(), false);
    if (refusal) throw new Error(refusal);
}
const judgeKey = o.judge ? await resolveCredential("api_key") : null;
if (o.judge && !judgeKey) throw new Error("--judge calls the Messages API and needs an API key in .env.local or Settings.");

const ws = workspaceDir();
// --matrix runs each model and effort pair in turn; a pair whose audit fails stops the rest.
for (const pair of o.matrix ?? [{ model: o.model, effort: o.effort }]) {
    const { file, result } = await runEval(
        { ...o, ...pair },
        {
            runAspect:
                o.access === "api_key"
                    ? apiAspectRunner(createClient(credential))
                    : sdkAspectRunner({ access: "claude_plan", credential, runDir: join(ws, "evals", "runs", String(Date.now())) }),
            scanners: dockerRunner(),
            fetchRulesets: dir => fetchRulesets(RULESETS, dir),
            workspaceDir: ws,
            resultsDir: "evals/results",
            ...(judgeKey ? { judge: createClient(judgeKey) } : {})
        }
    );
    const usd = result.byModel.reduce((s, m) => s + m.usd, 0);
    const judge = result.judge ? ` + judge $${result.judge.usd.toFixed(2)}` : "";
    console.log(
        `${file}\nRecall ${result.grade.found}/${result.grade.total}; ${result.grade.leftovers.length} findings outside the key; agents $${usd.toFixed(2)}${judge}.`
    );
    if (result.aborted) {
        console.error(`The audit was aborted: ${result.aborted}`);
        process.exit(1);
    }
}

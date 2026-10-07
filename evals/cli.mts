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

import { matrixCap, parseEvalArgs, runEval, unfinished } from "./run";

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
const cap = matrixCap(o);
if (cap) console.log(cap);
// --matrix runs each model and effort pair in turn. The plan's reserve is checked before each,
// since a pair it cuts short ends partial without aborting; an aborted or failed audit stops the
// rest, which would fail the same way.
const pairs = o.matrix ?? [{ model: o.model, effort: o.effort }];
const stop = (i: number, why: string) => {
    const rest = pairs.slice(i).map(p => `${p.model}:${p.effort}`);
    console.error(`${why}${rest.length ? `\nNot run: ${rest.join(", ")}.` : ""}`);
    process.exit(1);
};
for (const [i, pair] of pairs.entries()) {
    if (o.access === "claude_plan" && i > 0) {
        const refusal = reserveRefusal(await readPlanUsage(), false);
        if (refusal) stop(i, refusal);
    }
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
    const cut = unfinished(result);
    if (cut) console.error(`Not every agent finished (${cut}); the Evals page marks this result.`);
    if (result.aborted || result.agents.some(a => a.status === "failed")) stop(i + 1, "The audit failed.");
}

// `pnpm eval:key --fixture juice-shop [--source <clone>]`: writes the answer key of a fixture whose
// source marks its defects, read at the pinned commit (plan, Task 2.3). Runs git only; no model call.
// --source reads the pinned commit from a local clone instead of the fixture's URL.
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

import { workspaceDir } from "../src/engine/config";
import { git } from "../src/engine/git";

import { type FixtureSpec, loadFixtures } from "./fixtures";
import { type ChallengeMap, buildKey, keyYaml } from "./key";
import { prepareFixture } from "./prep/fixture";
import { JUICE_SHOP_RULES } from "./prep/juice-shop";

const RULES = { "juice-shop": JUICE_SHOP_RULES } as const;
const MAPS = { "juice-shop": "evals/answers/juice-shop-challenges.yaml" } as const;

const arg = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? process.argv[i + 1] : undefined;
};
const name = arg("--fixture") as keyof typeof RULES | undefined;
const spec: FixtureSpec | undefined = loadFixtures().find(f => f.name === name);
if (!name || !spec || !(name in RULES) || !spec.url)
    throw new Error("--fixture names a marked fixture with a URL in evals/fixtures.yaml: juice-shop.");

const prepared = await prepareFixture({ name, url: arg("--source") ?? spec.url, sha: spec.sha, rules: RULES[name] }, workspaceDir());
// The prepared repository's first commit is the pinned upstream tree, markers and all.
const marked = (await git(["grep", "-l", "vuln-code-snippet vuln-line", "HEAD~1"], prepared.path))
    .split("\n")
    .filter(Boolean)
    .map(l => l.replace(/^HEAD~1:/, ""));
const upstream = Object.fromEntries(
    await Promise.all(marked.map(async f => [f, await git(["show", `HEAD~1:${f}`], prepared.path)] as const))
);
const challenges = (parse(readFileSync(MAPS[name], "utf8")) as { challenges: ChallengeMap }).challenges;
const entries = buildKey(upstream, prepared.lineMap, challenges, prepared.path);
writeFileSync(
    `evals/answers/${name}-fixture.yaml`,
    keyYaml(name, entries, { upstreamSha: prepared.upstreamSha, preparedSha: prepared.preparedSha })
);
console.log(`${entries.length} entries from ${marked.length} marked files; prepared ${prepared.preparedSha} from ${prepared.upstreamSha}.`);
if (prepared.removedImports.length) console.log(`Imports of deleted modules removed:\n  ${prepared.removedImports.join("\n  ")}`);

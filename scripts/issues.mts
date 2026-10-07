// `pnpm issues:gh <drafts.json> --repo owner/name [--labels] [--create]`: the "Issues JSON" export as
// GitHub issues through the gh CLI. Without --create it only prints what it would create.
// .mts for top-level await, as scripts/smoke.mts.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { type IssueDraft, ghIssueCommands } from "../src/engine/report/exports";

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--repo");
const repo = argv[argv.indexOf("--repo") + 1];
if (!file || !argv.includes("--repo") || !repo) {
    console.error("pnpm issues:gh <drafts.json> --repo owner/name [--labels] [--create]");
    process.exit(2);
}
const drafts = JSON.parse(readFileSync(file, "utf8")) as IssueDraft[];
const commands = ghIssueCommands(drafts, repo, { labels: argv.includes("--labels") });
if (!argv.includes("--create")) {
    for (const c of commands) console.log(`gh ${c.args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    console.log(
        `\n${commands.length} ${commands.length === 1 ? "issue" : "issues"} would be created in ${repo}. Add --create to create them.`
    );
    process.exit(0);
}
for (const c of commands) {
    const r = spawnSync("gh", c.args, { input: c.stdin, encoding: "utf8" });
    if (r.status !== 0) {
        console.error(`Stopped at "${c.args[5]}": ${r.stderr.trim()}`);
        process.exit(1);
    }
    console.log(r.stdout.trim());
}

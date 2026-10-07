// `pnpm issues:gh <drafts.json> --repo owner/name [--labels] [--create [--public]]`: the "Issues
// JSON" export as GitHub issues through the gh CLI (src/engine/report/gh-issues.ts).
// .mts for top-level await, as scripts/smoke.mts.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { runIssues } from "../src/engine/report/gh-issues";

process.exit(
    runIssues(process.argv.slice(2), {
        gh: (args, input) => spawnSync("gh", args, { input, encoding: "utf8" }),
        read: file => readFileSync(file, "utf8"),
        out: line => console.log(line),
        err: line => console.error(line)
    })
);

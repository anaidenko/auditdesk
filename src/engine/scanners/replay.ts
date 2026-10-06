import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Ruleset, ScannerRunner } from "./types";

/** Serves recorded scanner outputs, so tests and end-to-end runs need no Docker images (design § 13). */
export function replayRunner(dir: string): ScannerRunner {
    return {
        async run(tool) {
            return { stdout: await readFile(join(dir, `${tool}.json`), "utf8"), stderr: "", exitCode: 0 };
        },
        async digest(tool) {
            return `replay/${tool}@sha256:recorded`;
        }
    };
}

export const REPLAY_RULESETS: Ruleset[] = [{ name: "javascript", file: "/dev/null", sha256: "recorded", rules: 0 }];

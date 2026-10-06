import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { IMAGES } from "./docker";
import { gitleaksArgs, parseGitleaks } from "./gitleaks";
import { osvArgs, parseOsv } from "./osv";
import { parseSemgrep, semgrepArgs } from "./semgrep";
import type { GitleaksLeak, OsvPackage, Ruleset, ScannerOutput, ScannerRunner, ScannerTool, SemgrepResult, ToolVersions } from "./types";

export interface ScanResults {
    leaks: GitleaksLeak[];
    osv: OsvPackage[];
    semgrep: SemgrepResult[];
    versions: ToolVersions;
}

// Exit codes that mean the scanner ran. gitleaks runs with --exit-code 0; osv-scanner exits 1
// when it finds vulnerabilities; OSV_NO_SOURCES is its "no lock file" exit, as recorded in Step 3.
export const OSV_NO_SOURCES = 128;
const OK: Record<ScannerTool, number[]> = { gitleaks: [0], osv: [0, 1, OSV_NO_SOURCES], semgrep: [0, 1] };

function checked(tool: ScannerTool, r: ScannerOutput): ScannerOutput {
    if (!OK[tool].includes(r.exitCode)) throw new Error(`${tool} failed (exit ${r.exitCode}): ${r.stderr.slice(-2000)}`);
    return r;
}

/** gitleaks runs first: no text may reach the model before the masker knows the secrets (design § 6). */
export async function runScanners(o: {
    clonePath: string;
    runner: ScannerRunner;
    rulesets: Ruleset[];
    rulesDir: string;
}): Promise<ScanResults> {
    const leaks = parseGitleaks(
        checked("gitleaks", await o.runner.run("gitleaks", gitleaksArgs(), [{ host: o.clonePath, container: "/repo" }])).stdout
    );
    const osvQueriedAt = new Date().toISOString();
    const osvRun = checked("osv", await o.runner.run("osv", osvArgs(), [{ host: o.clonePath, container: "/src" }]));
    const osv = osvRun.exitCode === OSV_NO_SOURCES ? [] : parseOsv(osvRun.stdout);
    const semgrep = parseSemgrep(
        checked(
            "semgrep",
            await o.runner.run("semgrep", semgrepArgs(o.rulesets), [
                { host: o.clonePath, container: "/src" },
                { host: o.rulesDir, container: "/rules" }
            ])
        ).stdout
    );
    const images = Object.fromEntries(
        await Promise.all(
            (Object.keys(IMAGES) as (keyof typeof IMAGES)[]).map(async t => [t, { image: IMAGES[t], digest: await o.runner.digest(t) }])
        )
    ) as ToolVersions["images"];
    return { leaks, osv, semgrep, versions: { images, rulesets: o.rulesets.map(({ file: _f, ...r }) => r), osvQueriedAt } };
}

/** Whether a leak's secret is still in the checked-out file, or only in history. */
export async function leakInTree(clonePath: string, leak: GitleaksLeak): Promise<boolean> {
    const text = await readFile(join(clonePath, leak.File), "utf8").catch(() => "");
    return text.includes(leak.Secret);
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { git } from "../git";

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

const decoded = (leak: GitleaksLeak) => leak.Tags?.some(t => t.startsWith("decoded:")) ?? false;

/**
 * The lines a leak sits on, as committed. For a secret gitleaks found by decoding base64, hex or
 * a URL encoding, `Secret` holds the decoded text, which the file never contains: only these raw
 * lines show up in what the agent reads. gitleaks' columns for such hits are not exact, so the
 * whole lines are masked.
 */
async function rawLines(clonePath: string, leak: GitleaksLeak): Promise<string[]> {
    const text = await git(["show", `${leak.Commit}:${leak.File}`], clonePath).catch(() => "");
    return text
        .split(/\r?\n/)
        .slice(leak.StartLine - 1, leak.EndLine)
        .filter(line => line.trim());
}

/** What the masker replaces for these leaks: each secret by value, and the encoded lines of decoded ones. */
export async function leakMasks(clonePath: string, leaks: GitleaksLeak[]): Promise<{ value: string; rule: string }[]> {
    const out: { value: string; rule: string }[] = [];
    for (const leak of leaks) {
        out.push({ value: leak.Secret, rule: leak.RuleID });
        if (decoded(leak)) for (const line of await rawLines(clonePath, leak)) out.push({ value: line, rule: leak.RuleID });
    }
    return out;
}

/** Whether a leak's secret is still in the checked-out file, or only in history. */
export async function leakInTree(clonePath: string, leak: GitleaksLeak): Promise<boolean> {
    const text = await readFile(join(clonePath, leak.File), "utf8").catch(() => "");
    if (!decoded(leak)) return text.includes(leak.Secret);
    const lines = await rawLines(clonePath, leak);
    return lines.length > 0 && lines.every(line => text.includes(line));
}

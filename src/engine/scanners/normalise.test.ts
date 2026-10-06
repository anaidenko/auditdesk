import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SAMPLE_KEY } from "@/test/sample-repo";

import { Masker } from "../masker";

import { normaliseGitleaks, parseGitleaks } from "./gitleaks";
import { OSV_NO_SOURCES, runScanners } from "./index";
import { normaliseOsv, parseOsv } from "./osv";
import { normaliseSemgrep, parseSemgrep } from "./semgrep";
import type { ScannerRunner, ScannerTool } from "./types";

const recorded = (name: string) => readFileSync(`src/test/fixtures/scanners/${name}.json`, "utf8");
const leaks = parseGitleaks(recorded("gitleaks"));
const masker = new Masker(leaks.map(l => ({ value: l.Secret, rule: l.RuleID })));

describe("gitleaks", () => {
    it("files a secret as a security finding under SEC-10 with the value masked", () => {
        const [f] = normaliseGitleaks(leaks, { repositoryId: "r", masker, inTree: () => true });
        expect(f).toMatchObject({ aspect: "security", checklistItem: "SEC-10", source: "scanner", severity: "critical" });
        expect(f.evidence[0].file).toBe("src/config.js");
        expect(JSON.stringify(f)).not.toContain(SAMPLE_KEY);
    });

    it("files each distinct secret of one rule in one file, so every one gets rotated", () => {
        const three = ["a1", "b2", "c3"].map(k => ({ ...leaks[0], Secret: `${k}${"0".repeat(30)}`, StartLine: k.charCodeAt(0) }));
        const prints = normaliseGitleaks(three, { repositoryId: "r", masker, inTree: () => true }).map(f => f.fingerprint);
        expect(new Set(prints).size).toBe(3);
        expect(prints.join()).not.toContain("0".repeat(30));
    });

    it("rates a secret found only in history one level lower and says so", () => {
        const [f] = normaliseGitleaks(leaks, { repositoryId: "r", masker, inTree: () => false });
        expect(f.severity).toBe("high");
        expect(f.title).toMatch(/history/);
    });
});

describe("osv-scanner", () => {
    it("files one dependency finding per vulnerable package with its advisories", () => {
        const findings = normaliseOsv(parseOsv(recorded("osv")), { repositoryId: "r" });
        const lodash = findings.find(f => f.title.includes("lodash"))!;
        expect(lodash).toMatchObject({ aspect: "dependencies", checklistItem: "DEP-01", source: "scanner" });
        expect(lodash.references.advisories!.length).toBeGreaterThan(0);
        expect(lodash.evidence[0].file).toBe("package-lock.json");
    });
});

describe("Semgrep", () => {
    it("maps a code-injection rule to SEC-04 by its CWE", () => {
        const findings = normaliseSemgrep(parseSemgrep(recorded("semgrep")), { repositoryId: "r", masker });
        // Line 7 also trips an XSS rule (direct-response-write, CWE-79); pick the eval rule by its ID.
        const evalFinding = findings.find(f => f.evidence[0].startLine === 7 && f.explanation.includes("code-string-concat"))!;
        expect(evalFinding.checklistItem).toBe("SEC-04");
        expect(evalFinding.references.cwe).toMatch(/^CWE-\d+$/);
        expect(evalFinding.evidence[0].file).toBe("src/server.js");
    });
});

describe("gitleaks configuration", () => {
    it("runs on the app's own rules, so the client's .gitleaks.toml, .gitleaksignore and gitleaks:allow cannot hide a secret", async () => {
        const calls: { tool: ScannerTool; args: string[]; mounts: { host: string; container: string }[] }[] = [];
        const runner: ScannerRunner = {
            async run(tool, args, mounts) {
                calls.push({ tool, args, mounts });
                return { stdout: recorded(tool), stderr: "", exitCode: 0 };
            },
            async digest() {
                return "d";
            }
        };
        const configDir = await mkdtemp(join(tmpdir(), "gitleaks-cfg-"));
        await runScanners({ clonePath: "/c", runner, rulesets: [], rulesDir: "/r", configDir });
        const gitleaks = calls.find(c => c.tool === "gitleaks")!;
        expect(gitleaks.args.join(" ")).toContain("--config /cfg/gitleaks.toml");
        expect(gitleaks.args.join(" ")).toContain("--gitleaks-ignore-path /cfg");
        expect(gitleaks.args).toContain("--ignore-gitleaks-allow");
        expect(gitleaks.mounts).toContainEqual({ host: configDir, container: "/cfg" });
        const config = await readFile(join(configDir, "gitleaks.toml"), "utf8");
        expect(config).toMatch(/useDefault = true/);
        expect(config).not.toMatch(/^\s*\[+allowlists?\]+/m);
    });

    it("ignores the client's nosem comments, .semgrepignore and osv-scanner.toml ignore lists", async () => {
        const calls: { tool: ScannerTool; args: string[]; mounts: { host: string; container: string }[] }[] = [];
        const runner: ScannerRunner = {
            async run(tool, args, mounts) {
                calls.push({ tool, args, mounts });
                return { stdout: recorded(tool), stderr: "", exitCode: 0 };
            },
            async digest() {
                return "d";
            }
        };
        const configDir = await mkdtemp(join(tmpdir(), "scanner-cfg-"));
        await runScanners({ clonePath: "/c", runner, rulesets: [], rulesDir: "/r", configDir });
        const semgrep = calls.find(c => c.tool === "semgrep")!.args;
        expect(semgrep).toContain("--disable-nosem");
        expect(semgrep).toContain("--x-ignore-semgrepignore-files");
        const osv = calls.find(c => c.tool === "osv")!;
        expect(osv.args.join(" ")).toContain("--config /cfg/osv-scanner.toml");
        expect(osv.mounts).toContainEqual({ host: configDir, container: "/cfg" });
        expect(await readFile(join(configDir, "osv-scanner.toml"), "utf8")).not.toMatch(/IgnoredVulns/);
    });
});

describe("runScanners exit codes", () => {
    const runner = (codes: Partial<Record<ScannerTool, number>>): ScannerRunner => ({
        async run(tool) {
            const exitCode = codes[tool] ?? 0;
            const stdout = exitCode === OSV_NO_SOURCES ? "" : recorded(tool);
            return { stdout, stderr: `${tool} said why`, exitCode };
        },
        async digest() {
            return "d";
        }
    });
    const scan = (codes: Partial<Record<ScannerTool, number>>) =>
        runScanners({
            clonePath: "/c",
            runner: runner(codes),
            rulesets: [],
            rulesDir: "/r",
            configDir: join(tmpdir(), "gitleaks-cfg-codes")
        });

    it("treats osv-scanner's no-lock-file exit as no packages", async () => {
        expect((await scan({ osv: OSV_NO_SOURCES })).osv).toEqual([]);
    });

    it("fails with the scanner's own message on any other exit", async () => {
        await expect(scan({ gitleaks: 2 })).rejects.toThrow(/gitleaks failed \(exit 2\): gitleaks said why/);
    });
});

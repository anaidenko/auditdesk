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

    it("rates a generic secret in a sample file lower and says why, keeping its fingerprint", () => {
        const inTest = leaks.map(l => ({ ...l, File: "test/api/login.test.ts" }));
        const [current] = normaliseGitleaks(inTest, { repositoryId: "r", masker, inTree: () => true });
        expect(current).toMatchObject({ severity: "medium", tags: [] });
        expect(current.title).toMatch(/[^.] \(in a test file\)$/);
        expect(current.likelihood).toBe("It is in a test file; whether the credential is real decides the risk.");
        expect(current.recommendation).toMatch(/^Check whether the credential is real/);
        expect(current.fingerprint).toBe("870d368c109f219076b2cacef84b1fde");
        const [history] = normaliseGitleaks(inTest, { repositoryId: "r", masker, inTree: () => false });
        expect(history.severity).toBe("low");
        expect(history.recommendation).toBe("Rotate it if it is real.");
    });

    it("keeps a provider's key at its usual severity in a sample file, and warns about seeds that run in production", () => {
        const stripe = leaks.map(l => ({ ...l, RuleID: "stripe-access-token", File: "prisma/seed.ts" }));
        const [f] = normaliseGitleaks(stripe, { repositoryId: "r", masker, inTree: () => true });
        expect(f.severity).toBe("critical");
        expect(f.title).toMatch(/\(in a seed file\)$/);
        const [generic] = normaliseGitleaks(
            leaks.map(l => ({ ...l, File: "prisma/seed.ts" })),
            { repositoryId: "r", masker, inTree: () => true }
        );
        expect(generic.likelihood).toMatch(/a seed that runs in production makes it a default credential on every deployment/);
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
        expect(evalFinding.tags).toEqual([]);
    });

    it("rates a result in a test file low, and a hard-coded secret as gitleaks would", () => {
        const results = parseSemgrep(recorded("semgrep")).map(r => ({ ...r, path: "test/server.spec.js" }));
        const findings = normaliseSemgrep(results, { repositoryId: "r", masker });
        expect(findings[0]).toMatchObject({ severity: "low", tags: [] });
        expect(findings[0].title).toMatch(/[^.] \(in a test file\)$/);
        const secret = normaliseSemgrep(
            results.map(r => ({
                ...r,
                extra: { ...r.extra, metadata: { ...r.extra.metadata, cwe: ["CWE-798: Use of Hard-coded Credentials"] } }
            })),
            { repositoryId: "r", masker }
        )[0];
        expect(secret).toMatchObject({ checklistItem: "SEC-10", severity: "medium" });
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

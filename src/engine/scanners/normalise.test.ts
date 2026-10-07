import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SAMPLE_KEY } from "@/test/sample-repo";

import { Masker } from "../masker";

import { normaliseGitleaks, parseGitleaks, secretKind } from "./gitleaks";
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

    const at = (Secret: string, File: string, StartLine: number, RuleID = "generic-api-key") => ({
        ...leaks[0],
        Secret,
        File,
        StartLine,
        EndLine: StartLine,
        RuleID
    });

    it("lists each distinct secret of one rule as its own place, so every one gets rotated", () => {
        const three = ["a1", "b2", "c3"].map((k, i) => at(`${k}${"0".repeat(30)}`, "src/config.js", i + 2));
        const [f, ...rest] = normaliseGitleaks(three, { repositoryId: "r", masker, inTree: () => true });
        expect(rest).toEqual([]);
        expect(new Set(f.evidence.map(e => e.key)).size).toBe(3);
        expect(JSON.stringify(f)).not.toContain("0".repeat(30));
    });

    it("titles a secret by its kind, short, with gitleaks' description in the details", () => {
        const [f] = normaliseGitleaks(leaks, { repositoryId: "r", masker, inTree: () => true });
        expect(f.title).toBe("Secret in the code: generic API key");
        expect(f.explanation).toMatch(/^gitleaks: Detected a Generic API Key, potentially exposing/);
    });

    it("names the kind of secret from the rule, spelled as the provider spells it", () => {
        const kind = (rule: string, description: string) => secretKind(rule, description);
        expect(kind("github-pat", "Uncovered a GitHub Personal Access Token, potentially leading to unauthorized access.")).toBe(
            "GitHub PAT"
        );
        expect(kind("new-relic-user-api-key", "Discovered a New Relic user API Key, which could lead to compromised insights.")).toBe(
            "New Relic user API key"
        );
        expect(kind("1password-secret-key", "Uncovered a possible 1Password secret key, potentially compromising vaults.")).toBe(
            "1Password secret key"
        );
        expect(kind("aws-access-token", "Identified a pattern that may indicate AWS credentials.")).toBe("AWS access token");
        expect(kind("private-key", "Identified a Private Key, which may compromise cryptographic security.")).toBe("private key");
        expect(kind("jwt", "Uncovered a JSON Web Token.")).toBe("JWT");
    });

    it("files one finding per rule, per code or history and per sample role, listing every place", () => {
        const mixed = [
            at("a".repeat(32), "src/b.js", 9),
            at("b".repeat(32), "src/a.js", 12),
            at("c".repeat(32), "src/a.js", 3),
            at("d".repeat(32), "test/x.test.js", 1),
            at("e".repeat(32), "src/old.js", 5),
            at("f".repeat(32), "src/k.pem", 1, "private-key")
        ];
        const out = normaliseGitleaks(mixed, { repositoryId: "r", masker, inTree: l => l.File !== "src/old.js" });
        expect(out.map(f => [f.title, f.severity, f.evidence.length])).toEqual([
            ["Secrets in the code: 3 generic API keys in 2 files", "critical", 3],
            ["Secret in the code: generic API key (in a test file)", "medium", 1],
            ["Secret in git history: generic API key", "high", 1],
            ["Secret in the code: private key", "critical", 1]
        ]);
        expect(out[0].evidence.map(e => `${e.file}:${e.startLine}`)).toEqual(["src/a.js:3", "src/a.js:12", "src/b.js:9"]);
        expect(out[0].summary).toBe('3 credentials matching gitleaks rule "generic-api-key" are committed in 2 files.');
        expect(out[0].likelihood).toBe("Anyone with read access to the repository can use them.");
        expect(out[0].recommendation).toMatch(/^Rotate the credentials first, then remove them/);
    });

    it("names each commit of secrets found only in history", () => {
        const two = [at("a".repeat(32), "src/a.js", 3), at("b".repeat(32), "src/b.js", 4)];
        const [f] = normaliseGitleaks(two, { repositoryId: "r", masker, inTree: () => false });
        expect(f.title).toBe("Secrets in git history: 2 generic API keys in 2 files");
        expect(f.explanation).toContain("Commits: src/a.js at c2bdcacd (2026-10-06); src/b.js at c2bdcacd (2026-10-06).");
    });

    it("keeps a single place's fingerprint, and files only the places not filed before", () => {
        const two = [at("a".repeat(32), "src/a.js", 3), at("b".repeat(32), "src/b.js", 4)];
        const [group] = normaliseGitleaks(two, { repositoryId: "r", masker, inTree: () => true });
        const [first, second] = group.evidence.map(e => e.key!);
        expect(group.fingerprint).not.toBe(first);
        const [alone] = normaliseGitleaks(two.slice(0, 1), { repositoryId: "r", masker, inTree: () => true });
        expect(alone.fingerprint).toBe(first);
        const [left] = normaliseGitleaks(two, { repositoryId: "r", masker, inTree: () => true, known: new Set([first]) });
        expect(left.evidence.map(e => e.key)).toEqual([second]);
        expect(normaliseGitleaks(two, { repositoryId: "r", masker, inTree: () => true, known: new Set([first, second]) })).toEqual([]);
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
    const [xss, concat] = parseSemgrep(recorded("semgrep"));
    const moved = (r: typeof concat, path: string, line: number, lines: string) => ({
        ...r,
        path,
        start: { line },
        end: { line },
        extra: { ...r.extra, lines }
    });

    it("files one finding per rule, listing every place", () => {
        const results = [concat, moved(concat, "src/b.js", 9, "eval(b)"), moved(concat, "src/server.js", 20, "eval(c)"), xss];
        const out = normaliseSemgrep(results, { repositoryId: "r", masker });
        expect(out).toHaveLength(2);
        expect(out[0].title).toMatch(/[^.] \(3 places in 2 files\)$/);
        expect(out[0].evidence.map(e => `${e.file}:${e.startLine}`)).toEqual(["src/b.js:9", "src/server.js:7", "src/server.js:20"]);
        expect(new Set(out[0].evidence.map(e => e.key)).size).toBe(3);
    });

    it("keeps the results of one rule apart when their messages differ", () => {
        const other = moved(concat, "src/b.js", 9, "eval(b)");
        other.extra = { ...other.extra, message: "Another message." };
        expect(normaliseSemgrep([concat, other], { repositoryId: "r", masker })).toHaveLength(2);
    });

    it("files only the places not filed before", () => {
        const results = [concat, moved(concat, "src/b.js", 9, "eval(b)")];
        const [group, ...none] = normaliseSemgrep(results, { repositoryId: "r", masker });
        expect(none).toEqual([]);
        const [first, second] = group.evidence.map(e => e.key!);
        expect(first && second).toBeTruthy();
        const [left] = normaliseSemgrep(results, { repositoryId: "r", masker, known: new Set([first]) });
        expect(left.evidence.map(e => e.key)).toEqual([second]);
        expect(left.title).not.toMatch(/places/);
    });

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

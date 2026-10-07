import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { Masker } from "../masker";

import { locatePackage, normaliseOsv, osvEvidence, parseOsv } from "./osv";
import type { OsvPackage } from "./types";

const PNPM = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      braces:
        specifier: ^3.0.0
        version: 3.0.3

packages:

  '@scope/pkg@1.0.0':
    resolution: {integrity: sha512-x}

  braces@3.0.3:
    resolution: {integrity: sha512-abc}
    engines: {node: '>=8'}

snapshots:

  braces@3.0.3:
    dependencies:
      fill-range: 7.1.1
`;

const NPM = `{
    "name": "app",
    "lockfileVersion": 3,
    "packages": {
        "node_modules/a/node_modules/lodash": {
            "version": "4.17.21"
        },
        "node_modules/lodash": {
            "version": "4.17.15",
            "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz"
        }
    }
}
`;

const YARN = `# yarn lockfile v1


lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"

lodash@^4.17.15, lodash@~4.17.0:
  version "4.17.15"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.15.tgz"
`;

const pkg = (over: Partial<OsvPackage> = {}): OsvPackage => ({
    source: "pnpm-lock.yaml",
    name: "braces",
    version: "3.0.3",
    ecosystem: "npm",
    vulnerabilities: [
        { id: "GHSA-1", aliases: [], summary: "Uncontrolled resource consumption" },
        { id: "GHSA-2", aliases: [], summary: "Something else" }
    ],
    maxSeverity: 7.5,
    ...over
});

describe("locatePackage", () => {
    it("points a pnpm package at its entry under packages:", () => {
        expect(locatePackage(PNPM, "braces", "3.0.3")).toEqual({ startLine: 16, endLine: 18 });
    });

    it("points a scoped pnpm package at its quoted entry", () => {
        expect(locatePackage(PNPM, "@scope/pkg", "1.0.0")).toEqual({ startLine: 13, endLine: 14 });
    });

    it("points an npm package at the node_modules entry holding its version, past another version", () => {
        expect(locatePackage(NPM, "lodash", "4.17.15")).toEqual({ startLine: 8, endLine: 11 });
    });

    it("points a yarn package at the entry whose version matches", () => {
        expect(locatePackage(YARN, "lodash", "4.17.15")).toEqual({ startLine: 8, endLine: 10 });
    });

    it("returns null for a package the lock file does not hold", () => {
        expect(locatePackage(PNPM, "undici", "7.29.0")).toBeNull();
    });

    it("does not take a package for one whose name it ends", () => {
        expect(locatePackage(PNPM.replaceAll("braces@3.0.3", "xbraces@3.0.3"), "braces", "3.0.3")).toBeNull();
    });
});

describe("osvEvidence", () => {
    it("reads each package's entry from the clone, masked", async () => {
        const repo = await makeRepo({ "pnpm-lock.yaml": PNPM.replace("sha512-abc", "sha512-SECRETVALUE") });
        const masker = new Masker([{ value: "SECRETVALUE", rule: "test" }]);
        const ev = await osvEvidence(repo, [pkg()], l => masker.mask(l));
        const [braces] = [...ev.values()];
        expect(braces).toMatchObject({ file: "pnpm-lock.yaml", startLine: 16, endLine: 18 });
        expect(braces.snippet).toContain("braces@3.0.3:");
        expect(braces.snippet).not.toContain("SECRETVALUE");
    });

    it("leaves out a package whose lock file is missing or outside the clone", async () => {
        const repo = await makeRepo({ "README.md": "x" });
        expect((await osvEvidence(repo, [pkg(), pkg({ source: "../outside.yaml" })], l => l)).size).toBe(0);
    });
});

describe("normaliseOsv", () => {
    it("uses the located entry as evidence and keeps the package's fingerprint", () => {
        const p = pkg();
        const [plain] = normaliseOsv([p], { repositoryId: "r" });
        const located = { file: "pnpm-lock.yaml", startLine: 16, endLine: 18, snippet: "  braces@3.0.3:\n    resolution: x" };
        const [withLines] = normaliseOsv([p], { repositoryId: "r", locate: q => (q === p ? located : null) });
        expect(withLines.evidence).toEqual([located]);
        expect(withLines.fingerprint).toBe(plain.fingerprint);
    });

    it("leaves Impact empty, since the explanation lists every advisory", () => {
        const [f] = normaliseOsv([pkg()], { repositoryId: "r" });
        expect(f.impact).toBeNull();
        expect(f.explanation).toContain("GHSA-1: Uncontrolled resource consumption");
    });

    it("still files every recorded package", () => {
        const recorded = parseOsv(readFileSync("src/test/fixtures/scanners/osv.json", "utf8"));
        expect(normaliseOsv(recorded, { repositoryId: "r" }).length).toBe(recorded.filter(p => p.vulnerabilities.length).length);
    });
});

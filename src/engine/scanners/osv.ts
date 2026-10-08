import { readFile } from "node:fs/promises";

import { snippetOf } from "../files";
import { fingerprint } from "../findings";
import { resolveInClone } from "../paths";
import type { Evidence, NewFinding, SeverityName } from "../types";

import type { OsvPackage } from "./types";

/** Overrides the client's osv-scanner.toml, whose ignore lists would hide known vulnerabilities. */
export const OSV_CONFIG = "# Written by Auditdesk for each run: no vulnerability is ignored.\n";

/**
 * --no-resolve: resolving a manifest without a lock file would send it to deps.dev and fetch a
 * pom.xml's parents from Maven Central and from any repository the client's code names.
 */
export function osvArgs(): string[] {
    return ["scan", "source", "--recursive", "--no-resolve", "--config", "/cfg/osv-scanner.toml", "--format", "json", "/src"];
}

interface OsvJson {
    results?: {
        source: { path: string };
        packages: {
            package: { name: string; version: string; ecosystem: string };
            vulnerabilities?: { id: string; aliases?: string[]; summary?: string }[];
            groups?: { max_severity?: string }[];
        }[];
    }[];
}

export function parseOsv(stdout: string): OsvPackage[] {
    if (!stdout.trim()) return [];
    const json = JSON.parse(stdout) as OsvJson;
    return (json.results ?? []).flatMap(r =>
        r.packages.map(p => {
            const scores = (p.groups ?? []).map(g => Number(g.max_severity)).filter(n => Number.isFinite(n) && n > 0);
            return {
                source: r.source.path.replace(/^\/src\//, ""),
                name: p.package.name,
                version: p.package.version,
                ecosystem: p.package.ecosystem,
                vulnerabilities: (p.vulnerabilities ?? []).map(v => ({ id: v.id, aliases: v.aliases ?? [], summary: v.summary ?? "" })),
                maxSeverity: scores.length ? Math.max(...scores) : null
            };
        })
    );
}

function severityFromCvss(score: number | null): SeverityName {
    if (score === null) return "medium";
    return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const indent = (line: string) => line.length - line.trimStart().length;
const MAX_ENTRY_LINES = 12;

/** A YAML-style entry: the header and the lines indented under it, up to a blank line. */
function yamlBlock(lines: string[], start: number): number {
    let end = start;
    while (end + 1 < lines.length && lines[end + 1].trim() && indent(lines[end + 1]) > indent(lines[start])) end++;
    return end;
}

/** A JSON object opened on `start`: up to the line that closes it at the same indentation. */
function jsonBlock(lines: string[], start: number): number {
    for (let i = start + 1; i < lines.length; i++) if (indent(lines[i]) === indent(lines[start]) && /^\s*\}/.test(lines[i])) return i;
    return start;
}

/**
 * Where a package's own entry sits in a pnpm, npm or yarn lock file, as 1-based lines, or null.
 * osv-scanner names the lock file but not the line.
 */
export function locatePackage(text: string, name: string, version: string): { startLine: number; endLine: number } | null {
    const lines = text.split(/\r?\n/);
    const n = escape(name);
    const v = escape(version);
    // v6 to v9 key a package `name@version`, with a leading slash in v6 and a peer suffix in v9; v5 keys it `/name/version`.
    const pnpm = new RegExp(`^\\s+(?:['"]?/?${n}@${v}(?:\\(.*\\))?['"]?|/${n}/${v}(?:_[^:]*)?):`);
    const npmKey = new RegExp(`^\\s*"(?:[^"]*node_modules/)?${n}"\\s*:\\s*\\{`);
    const npmVersion = new RegExp(`^\\s*"version"\\s*:\\s*"${v}"`);
    const yarnVersion = new RegExp(`^\\s+version:?\\s+"?${v}"?\\s*$`);
    // A yarn header lists specifiers, the first of which may be an alias: "a-cjs@npm:a@^1", "a@^1":
    const yarnHeader = (line: string) =>
        !/^\s/.test(line) &&
        line
            .replace(/:\s*$/, "")
            .split(/,\s*/)
            .some(spec => spec.replace(/^"|"$/g, "").startsWith(`${name}@`));
    // pnpm lists patches and importers before `packages:`; a package's own entry is under it.
    const pnpmFrom = lines.findIndex(l => /^packages:\s*$/.test(l));
    const range = (start: number, end: number) => ({ startLine: start + 1, endLine: Math.min(end, start + MAX_ENTRY_LINES - 1) + 1 });
    for (let i = 0; i < lines.length; i++) {
        if (i > pnpmFrom && pnpm.test(lines[i])) return range(i, yamlBlock(lines, i));
        if (npmKey.test(lines[i])) {
            const end = jsonBlock(lines, i);
            const child = indent(lines[i + 1] ?? "");
            if (lines.slice(i + 1, end).some(l => indent(l) === child && npmVersion.test(l))) return range(i, end);
        }
        if (yarnHeader(lines[i])) {
            const end = yamlBlock(lines, i);
            if (lines.slice(i + 1, end + 1).some(l => yarnVersion.test(l))) return range(i, end);
        }
    }
    return null;
}

/** Each vulnerable package's entry in its lock file in the clone, masked. A package not found is left out. */
export async function osvEvidence(
    clonePath: string,
    pkgs: OsvPackage[],
    mask: (line: string) => string
): Promise<Map<OsvPackage, Evidence>> {
    const out = new Map<OsvPackage, Evidence>();
    const texts = new Map<string, string | null>();
    for (const p of pkgs.filter(p => p.vulnerabilities.length)) {
        if (!texts.has(p.source)) {
            const text = await resolveInClone(clonePath, p.source)
                .then(({ abs }) => readFile(abs, "utf8"))
                .catch(() => null);
            texts.set(p.source, text);
        }
        const text = texts.get(p.source);
        const at = text ? locatePackage(text, p.name, p.version) : null;
        if (text && at) out.set(p, { file: p.source, ...at, snippet: snippetOf(text.split(/\r?\n/), at.startLine, at.endLine, mask) });
    }
    return out;
}

export function normaliseOsv(pkgs: OsvPackage[], o: { repositoryId: string; locate?: (p: OsvPackage) => Evidence | null }): NewFinding[] {
    return pkgs
        .filter(p => p.vulnerabilities.length)
        .map(p => {
            const ids = p.vulnerabilities.map(v => v.id);
            const identity = { repositoryId: o.repositoryId, aspect: "dependencies", checklistItem: "DEP-01" };
            // The fingerprint stays on the package, not on its lines, so a re-run recognises what was filed before.
            const named = [{ file: p.source, startLine: 1, endLine: 1, snippet: `${p.name}@${p.version}` }];
            return {
                ...identity,
                evidence: [o.locate?.(p) ?? named[0]],
                agentRunId: null,
                kind: "finding",
                title: `${p.name} ${p.version}: ${ids.length} known ${ids.length === 1 ? "vulnerability" : "vulnerabilities"}`,
                severity: severityFromCvss(p.maxSeverity),
                likelihood: null,
                impact: null,
                summary: `${p.name} ${p.version} (${p.ecosystem}) has published advisories: ${ids.join(", ")}.`,
                explanation: p.vulnerabilities.map(v => `${v.id}: ${v.summary}`).join("\n"),
                recommendation: `Upgrade ${p.name} to a release that fixes these advisories, then re-run the tests.`,
                effort: "S",
                effortHours: null,
                references: { advisories: ids },
                tags: [],
                source: "scanner",
                fingerprint: fingerprint({ ...identity, evidence: named })
            } satisfies NewFinding;
        });
}

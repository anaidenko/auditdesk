import ignore, { type Ignore } from "ignore";
import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";

import { ToolError, resolveInClone, walk } from "./paths";

/** The source name of the patterns the auditor typed for a repository. */
export const AUDITOR = "the auditor's exclusions";

export interface PolicyPattern {
    line: number;
    pattern: string;
    /** Why the pattern does not apply as written. */
    note?: "outside the repository, not applicable" | "not a usable pattern; it guards its literal path" | "no file may be read";
}

export interface PolicySource {
    /** The file the patterns come from, relative to the repository root, or AUDITOR. */
    file: string;
    tool: string;
    /** Read by no tool (.claudeignore): the team's intent, honoured all the same. */
    intent?: boolean;
    /** A nested file of a tool documented to read only the root one: honoured, anchored at its directory. */
    nested?: boolean;
    patterns: PolicyPattern[];
}

export interface AiPolicy {
    sources: PolicySource[];
    warnings: string[];
    /** Where a bare `Read` deny stands, as file:line: no file may be read. */
    readsNothing: string | null;
    /** The first source that excludes a path relative to the root; null when none does. */
    match(rel: string): PolicySource | null;
    /** Every source that excludes it. */
    matches(rel: string): PolicySource[];
}

export const NO_POLICY: AiPolicy = { sources: [], warnings: [], readsNothing: null, match: () => null, matches: () => [] };

const SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];

/** `nestedRead`: the tool documents ignore files in subdirectories, not only at the root. */
const IGNORE_FILES: Record<string, { tool: string; nestedRead?: boolean; intent?: boolean }> = {
    ".cursorignore": { tool: "Cursor" },
    ".aiexclude": { tool: "Gemini Code Assist", nestedRead: true },
    ".geminiignore": { tool: "Gemini CLI" },
    ".aiignore": { tool: "JetBrains AI Assistant and Junie" },
    ".codeiumignore": { tool: "Windsurf" },
    ".aiderignore": { tool: "Aider" },
    ".claudeignore": { tool: "no tool (intent)", intent: true }
};

/** A file under `dir` (relative to the root) that the tests run against to tell a directory excluded as a whole. */
const PROBE = "auditdesk-probe/auditdesk-probe";

type Test = (rel: string) => boolean;

/** gitignore's patterns, case-insensitive: the clone sits on macOS's file system, where TLS/ opens tls/. */
const matcher = (): Ignore => ignore({ ignorecase: true });

/** A `[` never closed, or a lone trailing backslash: git matches no path with it. */
function unusable(pattern: string): boolean {
    if (/(?:^|[^\\])\\$/.test(pattern)) return true;
    const open = pattern.replace(/\\./g, "").lastIndexOf("[");
    if (open >= 0 && pattern.replace(/\\./g, "").indexOf("]", open) < 0) return true;
    try {
        matcher().add(pattern).ignores("auditdesk-probe");
        return false;
    } catch {
        return true;
    }
}

const literal = (path: string): Test => {
    const lower = path.toLowerCase();
    return rel => rel.toLowerCase() === lower || rel.toLowerCase().startsWith(`${lower}/`);
};

const testOf =
    (ig: Ignore): Test =>
    rel =>
        ig.ignores(rel);

/** A pattern's line in a JSON file: the first occurrence of its string after `from`. */
function lineOf(text: string, value: string, from: number): { line: number; at: number } {
    const at = text.indexOf(JSON.stringify(value), from);
    if (at < 0) return { line: 1, at: from };
    return { line: text.slice(0, at).split("\n").length, at: at + 1 };
}

function readSettings(
    file: string,
    text: string,
    warnings: string[]
): { source: PolicySource; test: Test; readsNothing: string | null } | null {
    let deny: unknown;
    try {
        deny = (JSON.parse(text.replace(/^﻿/, "")) as { permissions?: { deny?: unknown } })?.permissions?.deny;
    } catch {
        warnings.push(`${file} is not valid JSON: its Read rules could not be read.`);
        return null;
    }
    if (!Array.isArray(deny)) return null;
    // Two sets, as Claude Code applies them: a negation carves from earlier path and ./path rules
    // of its own file, never from /-anchored ones.
    const anchored = matcher();
    const rest = matcher();
    const literals: Test[] = [];
    const patterns: PolicyPattern[] = [];
    let readsNothing: string | null = null;
    let from = Math.max(0, text.indexOf('"deny"'));
    for (const rule of deny) {
        if (typeof rule !== "string") continue;
        const m = rule.trim().match(/^Read(?:\(([^]*)\))?$/);
        if (!m) continue;
        const where = lineOf(text, rule, from);
        from = where.at;
        const entry: PolicyPattern = { line: where.line, pattern: rule };
        patterns.push(entry);
        let body = (m[1] ?? "").trim();
        const negative = body.startsWith("!");
        if (negative) body = body.slice(1);
        if (body.startsWith("//") || body.startsWith("~/") || body === "~") {
            entry.note = "outside the repository, not applicable";
            continue;
        }
        const isAnchored = body.startsWith("/");
        const path = body.replace(/^\.\/+/, "").replace(/^\/+/, "");
        if (!negative && (path === "" || path === ".")) {
            entry.note = "no file may be read";
            readsNothing ??= `${file}:${where.line}`;
            continue;
        }
        if (unusable(path)) {
            entry.note = "not a usable pattern; it guards its literal path";
            warnings.push(`${file}:${where.line}: "${rule}" is not a usable gitignore pattern; it guards its literal path only.`);
            if (!negative) literals.push(literal(path));
            continue;
        }
        // Claude Code reads `secrets/**` as that directory at any depth; gitignore would anchor it.
        const deep = !isAnchored && /^[^/]+\/\*\*$/.test(path) ? `**/${path}` : path;
        const gitPattern = `${negative ? "!" : ""}${isAnchored ? "/" : ""}${deep}`;
        if (isAnchored && !negative) anchored.add(gitPattern);
        else if (!isAnchored) rest.add(gitPattern);
    }
    if (!patterns.length) return null;
    const tests = [testOf(anchored), testOf(rest), ...literals];
    const all: Test = readsNothing ? () => true : rel => tests.some(t => t(rel));
    return { source: { file, tool: "Claude Code", patterns }, test: all, readsNothing };
}

/** An ignore file's patterns, anchored at `dir` ("" for the root): git's syntax and negation. */
function readIgnore(text: string, dir: string, warnings: string[], file: string): { patterns: PolicyPattern[]; test: Test } {
    const ig = matcher();
    const literals: Test[] = [];
    const patterns: PolicyPattern[] = [];
    text.split(/\r?\n/).forEach((raw, i) => {
        const pattern = raw.replace(/\s+$/, "");
        if (!pattern || pattern.startsWith("#")) return;
        patterns.push({ line: i + 1, pattern });
        if (unusable(pattern.replace(/^!/, ""))) {
            patterns.at(-1)!.note = "not a usable pattern; it guards its literal path";
            warnings.push(`${file}:${i + 1}: "${pattern}" is not a usable gitignore pattern; it guards its literal path only.`);
            if (!pattern.startsWith("!")) literals.push(literal(pattern.replace(/^\/+/, "")));
            return;
        }
        ig.add(pattern);
    });
    const inside = (rel: string) =>
        dir ? (rel.toLowerCase().startsWith(`${dir.toLowerCase()}/`) ? rel.slice(dir.length + 1) : null) : rel;
    return {
        patterns,
        test: rel => {
            const r = inside(rel);
            return r !== null && r !== "" && (ig.ignores(r) || literals.some(t => t(r)));
        }
    };
}

/** Reads the clone's policy: the settings at the root, every ignore file, then the auditor's patterns. */
export async function readAiPolicy(root: string, o: { auditor?: string | null } = {}): Promise<AiPolicy> {
    const warnings: string[] = [];
    const entries: { source: PolicySource; test: Test }[] = [];
    let readsNothing: string | null = null;
    for (const file of SETTINGS) {
        // Through resolveInClone: a committed symlink could point at another client's settings.
        const at = await resolveInClone(root, file).catch((e: Error) => {
            if (/leaves the repository/.test(e.message)) warnings.push(`${file} leaves the repository through a symlink: it was not read.`);
            return null;
        });
        const text = at && (await readText(at.abs));
        if (!text) continue;
        const read = readSettings(file, text, warnings);
        if (!read) continue;
        entries.push(read);
        readsNothing ??= read.readsNothing;
    }
    for (const e of await ignoreFiles(root)) {
        const name = e.rel.slice(e.rel.lastIndexOf("/") + 1);
        const kind = IGNORE_FILES[name];
        // A committed symlink is read where it leads, as its tool would, if that stays in the clone.
        const at = e.symlink
            ? await resolveInClone(root, e.rel).catch((err: Error) => {
                  if (/leaves the repository/.test(err.message))
                      warnings.push(`${e.rel} leaves the repository through a symlink: it was not read.`);
                  return null;
              })
            : { abs: join(root, e.rel) };
        const text = at && (await readText(at.abs));
        if (text === null || text === undefined) continue;
        const dir = e.rel.includes("/") ? e.rel.slice(0, e.rel.lastIndexOf("/")) : "";
        const { patterns, test } = readIgnore(text, dir, warnings, e.rel);
        if (!patterns.length) {
            if (name === ".aiexclude")
                warnings.push(
                    `${e.rel} has no patterns; Android Studio reportedly reads an empty one as excluding everything below it (unverified). Nothing is excluded by it here.`
                );
            continue;
        }
        entries.push({
            source: {
                file: e.rel,
                tool: kind.tool,
                ...(kind.intent && { intent: true }),
                ...(dir && !kind.nestedRead && { nested: true }),
                patterns
            },
            test
        });
    }
    if (o.auditor?.trim()) {
        const { patterns, test } = readIgnore(o.auditor, "", warnings, AUDITOR);
        if (patterns.length) entries.push({ source: { file: AUDITOR, tool: "the auditor", patterns }, test });
    }
    const matches = (rel: string) => {
        const path = normalise(rel);
        return path === null ? [] : entries.filter(e => e.test(path)).map(e => e.source);
    };
    return {
        sources: entries.map(e => e.source),
        warnings,
        readsNothing,
        matches,
        match: rel => {
            const path = normalise(rel);
            return path === null ? null : (entries.find(e => e.test(path))?.source ?? null);
        }
    };
}

const readText = (path: string): Promise<string | null> => readFile(path, "utf8").catch(() => null);

/**
 * Every ignore file of IGNORE_FILES in the clone, in walk order, symlinks included. Unlike `walk`, it
 * looks into vendor/, build/ and the like: read_file reads them, so their rules hold there.
 */
async function ignoreFiles(root: string, dir = ""): Promise<{ rel: string; symlink: boolean }[]> {
    const found: { rel: string; symlink: boolean }[] = [];
    const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        // node_modules holds packages' own files, published by their authors, not the client's rules.
        if (e.isDirectory() && e.name !== ".git" && e.name !== "node_modules") found.push(...(await ignoreFiles(root, rel)));
        else if (IGNORE_FILES[e.name] && (e.isFile() || e.isSymbolicLink())) found.push({ rel, symlink: e.isSymbolicLink() });
    }
    return found;
}

/** A path relative to the root as the rules see it, or null for the root itself and paths that leave it. */
function normalise(rel: string): string | null {
    const path = posix
        .normalize(rel)
        .replace(/^(\.\/)+/, "")
        .replace(/\/+$/, "");
    if (!path || path === "." || path === ".." || path.startsWith("../") || path.startsWith("/")) return null;
    return path;
}

/** The source excluding any of the paths: the one the agent asked for and the one it resolves to. */
export function excludedBy(policy: AiPolicy, ...paths: string[]): PolicySource | null {
    for (const p of paths) {
        const source = policy.match(p);
        if (source) return source;
    }
    return null;
}

/**
 * resolveInClone, then the policy, on both paths: the one asked for first, so a path in an excluded
 * directory is refused before the clone says whether it exists, then the real one after symlinks.
 */
export async function checkReadable(policy: AiPolicy | undefined, root: string, path: string): Promise<{ abs: string; rel: string }> {
    const asked = policy && excludedBy(policy, path);
    if (asked) throw refusal(path, asked);
    const resolved = await resolveOrRefuse(policy, root, path, rel => excludedBy(policy!, rel));
    const real = policy && excludedBy(policy, resolved.rel);
    if (real) throw refusal(path, real);
    return resolved;
}

/**
 * A directory to list: refused, as a file would be, when the rules exclude it as a whole (any new
 * file in it, asked or real), whether it exists or not; `whole` is that source, for a directory
 * whose listing turns out to hold only excluded files.
 */
export async function checkListable(
    policy: AiPolicy | undefined,
    root: string,
    dir: string
): Promise<{ abs: string; rel: string; whole: PolicySource | null }> {
    const asked = policy ? dirSource(policy, dir) : null;
    const resolved = await resolveOrRefuse(policy, root, dir, rel => asked ?? dirSource(policy!, rel));
    return { ...resolved, whole: asked ?? (policy ? dirSource(policy, resolved.rel) : null) };
}

export const refusal = (path: string, source: PolicySource) =>
    new ToolError(`${path} is excluded by the client's AI policy (${source.file}).`);

/** The source that would exclude a new file in the directory. */
export const dirSource = (policy: AiPolicy, dir: string) => policy.match(`${dir.replace(/\/+$/, "")}/${PROBE}`);

/**
 * resolveInClone, except that a path that does not exist is refused when its real form (its longest
 * existing ancestor resolved through symlinks, then the rest) is excluded: "no such file" would
 * otherwise name what an excluded directory holds.
 */
async function resolveOrRefuse(
    policy: AiPolicy | undefined,
    root: string,
    path: string,
    excludes: (real: string) => PolicySource | null
): Promise<{ abs: string; rel: string }> {
    try {
        return await resolveInClone(root, path);
    } catch (e) {
        if (!policy || !(e instanceof ToolError) || !e.message.startsWith("No such file")) throw e;
        const parts = normalise(path)?.split("/") ?? [];
        for (let i = parts.length - 1; i > 0; i--) {
            const at = await resolveInClone(root, parts.slice(0, i).join("/")).catch(() => null);
            if (!at) continue;
            const real = [...(at.rel === "." ? [] : [at.rel]), ...parts.slice(i)].join("/");
            const source = excludes(real);
            if (source) throw refusal(path, source);
            break;
        }
        throw e;
    }
}

/**
 * The areas excluded files are shown as: the top-most directory at or under `base` that the rules
 * exclude as a whole (every file in it, and any new one), with its file count, or the file itself.
 */
export function areasOf(rels: string[], excluded: (rel: string) => boolean, base = ""): { area: string; files: number }[] {
    const areas = new Map<string, number>();
    for (const area of areaMap(rels, excluded, base).values()) areas.set(area, (areas.get(area) ?? 0) + 1);
    return [...areas].map(([area, files]) => ({ area, files }));
}

/** Each excluded file under `base`, to the area it is shown as ("certs/" or its own path). */
export function areaMap(rels: string[], excluded: (rel: string) => boolean, base = ""): Map<string, string> {
    const ancestors = (rel: string) => {
        const parts = rel.split("/");
        return parts
            .slice(0, -1)
            .map((_, i) => parts.slice(0, i + 1).join("/"))
            .filter(d => !base || d === base || d.startsWith(`${base}/`));
    };
    const total = new Map<string, number>();
    const out = new Map<string, number>();
    const under = base ? rels.filter(rel => rel.startsWith(`${base}/`)) : rels;
    const hit = under.filter(excluded);
    for (const rel of under) for (const d of ancestors(rel)) total.set(d, (total.get(d) ?? 0) + 1);
    for (const rel of hit) for (const d of ancestors(rel)) out.set(d, (out.get(d) ?? 0) + 1);
    const whole = new Map<string, boolean>();
    const isWhole = (d: string) => {
        if (!whole.has(d)) whole.set(d, total.get(d) === out.get(d) && excluded(`${d}/${PROBE}`));
        return whole.get(d)!;
    };
    return new Map(
        hit.map(rel => {
            const dir = ancestors(rel).find(isWhole);
            return [rel, dir ? `${dir}/` : rel];
        })
    );
}

/** The test areaMap takes: a listed file by one pass of the rules, a probe path by the rules. */
export function exclusionTest(policy: AiPolicy, rels: string[]): (rel: string) => boolean {
    const known = new Set(rels);
    const hit = new Set(rels.filter(rel => policy.match(rel)));
    return rel => (known.has(rel) ? hit.has(rel) : !!policy.match(rel));
}

export const MAX_AREAS = 100;

/** The policy as the project page and the report show it, counted on the clone's files. */
export interface AiPolicySummary {
    sources: (PolicySource & { excludedFiles: number })[];
    warnings: string[];
    readsNothing: string | null;
    files: number;
    excludedFiles: number;
    /** The excluded areas, "certs/ (2 files)" or a file's path, at most MAX_AREAS and then "and N more". */
    excluded: string[];
    /** No file of the repository may be read: the run refuses it. */
    everything: boolean;
}

/** What tells one policy from another: its sources and patterns, not the counts, which move with the commit. */
export function policyKey(s: AiPolicySummary | null | undefined): string {
    return JSON.stringify((s?.sources ?? []).map(x => [x.file, x.intent ?? false, x.patterns.map(p => p.pattern)]));
}

export async function summarizePolicy(policy: AiPolicy, root: string): Promise<AiPolicySummary> {
    const rels: string[] = [];
    const regular = new Set<string>();
    for await (const e of walk(root)) {
        rels.push(e.rel);
        if (!("symlink" in e)) regular.add(e.rel);
    }
    const known = new Set(rels);
    const counts = new Map<PolicySource, number>();
    const hit = new Set<string>();
    for (const rel of rels) {
        const by = policy.matches(rel);
        if (by.length) hit.add(rel);
        for (const s of by) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    // The auditor types these from a client's words: one that matches nothing is most likely a mistake.
    const unmatched = (policy.sources.find(s => s.file === AUDITOR)?.patterns ?? [])
        .filter(p => !p.note && !p.pattern.startsWith("!"))
        .filter(p => {
            const ig = matcher().add(p.pattern);
            return !rels.some(rel => ig.ignores(rel));
        })
        .map(
            p =>
                `The auditor's pattern "${p.pattern}" matches no file${/\/./.test(p.pattern.replace(/^\//, "")) ? "; a slash before its end anchors it at the repository root" : ""}.`
        );
    const areas = areasOf(rels, rel => hit.has(rel) || (!known.has(rel) && !!policy.match(rel))).map(a =>
        a.area.endsWith("/") ? `${a.area} (${a.files} ${a.files === 1 ? "file" : "files"})` : a.area
    );
    return {
        sources: policy.sources.map(s => ({ ...s, excludedFiles: counts.get(s) ?? 0 })),
        warnings: [...policy.warnings, ...unmatched],
        readsNothing: policy.readsNothing,
        files: rels.length,
        excludedFiles: hit.size,
        excluded: areas.length > MAX_AREAS ? [...areas.slice(0, MAX_AREAS), `and ${areas.length - MAX_AREAS} more`] : areas,
        everything: !!policy.readsNothing || (regular.size > 0 && [...regular].every(rel => hit.has(rel)))
    };
}

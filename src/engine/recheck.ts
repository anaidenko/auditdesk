import { createHash } from "node:crypto";

import { CUT_NOTE, SNIPPET_LINES } from "./files";
import type { Evidence, NewFinding, References } from "./types";

/**
 * What a re-audit found of a finding reported at an earlier commit (design § 9). Its own reading:
 * the cited code `unchanged`, `changed`, `fixed` (a dependency or Semgrep result the scanner no
 * longer reports, its code gone), or `regressed`. Andrii's call on it: `fixed` or still `open`.
 */
export type RecheckStatus = "unchanged" | "open" | "fixed" | "changed" | "regressed";

export interface EarlierFinding {
    id: string;
    label: string;
    source: "agent" | "scanner";
    fingerprint: string;
    title: string;
    checklistItem: string | null;
    references: References;
    evidence: Evidence[];
    recheck: RecheckStatus | null;
    /** What the cited code looked like at the last re-check: Andrii's "still open" stands while it does. */
    recheckDigest: string | null;
    /** The cited code was absent at a re-check after the finding was fixed: its return is a regression. */
    recheckGone: boolean;
}

export interface RecheckResult {
    id: string;
    label: string;
    status: RecheckStatus;
    digest: string;
    gone: boolean;
    /** Nothing new to report: a fixed finding stays fixed, so its re-check keeps the commit it was fixed at. */
    keep: boolean;
    /** The cited lines where the blocks now stand, when every one was found. */
    evidence?: Evidence[];
    /** A scanner finding of several places: how many the scan still reports (a secret) or whose code is still there (Semgrep). */
    places?: { left: number; of: number };
}

/** A snippet shorter than this matches too much of a file to show the finding's code is still there. */
const MIN_CHARS = 20;
const squash = (s: string) => s.replace(/\s+/g, "");

/** Where the snippet's lines stand together in the file, whatever their spaces or place; null when they do not. */
function locate(fileLines: string[], snippet: string): { startLine: number; endLine: number } | null {
    const want = snippet
        .split("\n")
        .map(l => ({ text: squash(l.replace(CUT_NOTE, "")), cut: CUT_NOTE.test(l) }))
        .filter(l => l.text);
    const have = fileLines.map((l, i) => ({ text: squash(l), line: i + 1 })).filter(l => l.text);
    if (!want.length) return null;
    for (let i = 0; i + want.length <= have.length; i++)
        if (want.every((w, j) => (w.cut ? have[i + j].text.startsWith(w.text) : have[i + j].text === w.text)))
            return { startLine: have[i].line, endLine: have[i + want.length - 1].line };
    return null;
}

const digestOf = (parts: string[]) => createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);

type Kind = "gitleaks" | "osv" | "semgrep";
const kindOf = (f: { checklistItem: string | null; title: string; references: References }): Kind =>
    f.checklistItem === "DEP-01" && f.references.advisories?.length
        ? "osv"
        : // A secret is told by its weakness as well as its title, which Andrii may edit: never "fixed" by a scan.
          f.checklistItem === "SEC-10" && (/^Secrets? in (the code|git history)/.test(f.title) || f.references.cwe === "CWE-798")
          ? "gitleaks"
          : "semgrep";
const inCode = (title: string) => /^Secrets? in the code/.test(title);

/**
 * Checks each earlier finding against this run's scanners and the new clone, before the agents
 * run. An agent's cited code that is still there reads "code unchanged", never "still open": the
 * fix may live elsewhere, so only Andrii says it is open or fixed. Code that moved on reads
 * "changed" for him to verify. A scanner's finding is fixed only when nothing says otherwise: a
 * dependency whose advisories no lock file reports, a Semgrep result whose code is gone. A secret
 * is never fixed by a scan, since none can tell it was rotated. A scanner's finding of several
 * places is checked place by place: fixed once none is left (Semgrep), changed while some are.
 * `read` gives a file's lines at the new commit, masked like snippets.
 */
export async function recheck(
    earlier: EarlierFinding[],
    o: { scanners: NewFinding[]; read: (file: string) => Promise<string[] | null> }
): Promise<RecheckResult[]> {
    // Every place the scanners report now, by its own key; a finding of one place by its fingerprint too.
    const reported = new Map<string, NewFinding>();
    for (const s of o.scanners) {
        reported.set(s.fingerprint, s);
        for (const e of s.evidence) if (e.key) reported.set(e.key, s);
    }
    const out: RecheckResult[] = [];
    for (const f of earlier) {
        // true: the finding's code or scanner result is still there; false: gone; null: it changed.
        let present: boolean | null;
        let digest: string;
        let evidence: Evidence[] | undefined;
        let places: RecheckResult["places"];
        let back: boolean | null = null;
        let legacy: string | null = null;
        if (f.source === "scanner" && kindOf(f) === "osv") {
            const now = reported.get(f.fingerprint);
            present = now
                ? now.title === f.title
                    ? true
                    : null
                : o.scanners.some(s => s.references.advisories?.some(a => f.references.advisories!.includes(a)))
                  ? null
                  : false;
            digest = digestOf([String(present), now?.title ?? ""]);
        } else if (f.source === "scanner") {
            const kind = kindOf(f);
            // Each place by its own key. A finding filed before grouping is known by its fingerprint at its
            // first place; a place merged in by hand has no key and is found by its code.
            const cited: (Partial<Evidence> & { key?: string })[] = f.evidence.length
                ? f.evidence.map((e, i) => ({ ...e, key: e.key ?? (i === 0 ? f.fingerprint : undefined) }))
                : [{ key: f.fingerprint }];
            // An edited title no longer says whether the secret was in the code or the history.
            const was = /^Secrets? in (the code|git history)/.test(f.title) ? inCode(f.title) : null;
            const states: (boolean | null)[] = [];
            for (const e of cited) {
                const now = e.key ? reported.get(e.key) : undefined;
                // A secret moved between the code and the history: the same secret, but the report it gave is no longer true.
                if (kind === "gitleaks") states.push(now ? (was === null || inCode(now.title) === was ? true : null) : null);
                else if (now) states.push(true);
                else {
                    const snippet = e.snippet;
                    const elsewhere =
                        !!snippet &&
                        o.scanners.some(
                            s => s.checklistItem === f.checklistItem && s.evidence.some(x => squash(x.snippet ?? "") === squash(snippet))
                        );
                    const lines = snippet && e.file ? await o.read(e.file) : null;
                    states.push(elsewhere || (lines && snippet && locate(lines, snippet)) ? null : false);
                }
            }
            present = states.every(s => s === true) ? true : kind === "semgrep" && states.every(s => s === false) ? false : null;
            if (cited.length > 1) {
                // One place of a fixed rule reported again is a regression, though the others stay fixed.
                back = kind === "semgrep" ? states.some(s => s === true) : present === true;
                places = {
                    left:
                        kind === "gitleaks"
                            ? cited.filter(e => e.key && reported.has(e.key)).length
                            : states.filter(s => s !== false).length,
                    of: cited.length
                };
            }
            digest = digestOf([String(present), ...cited.map((e, i) => `${e.key ?? e.file}:${states[i]}`)]);
            // The digest before places had keys: Andrii's "still open" on such a finding stands.
            if (!f.evidence.some(e => e.key) && cited.length === 1) legacy = digestOf([String(present), present ? f.title : ""]);
        } else {
            const cited = f.evidence.filter(e => e.snippet?.trim());
            const readable = cited.length > 0 && cited.every(e => e.endLine - e.startLine < SNIPPET_LINES);
            const enough = squash(cited.map(e => e.snippet).join("")).length >= MIN_CHARS;
            const files: string[] = [];
            const moved: Evidence[] = [];
            for (const e of cited) {
                const lines = await o.read(e.file);
                files.push(`${e.file}\n${lines?.join("\n") ?? ""}`);
                const at = lines && locate(lines, e.snippet!);
                if (at) moved.push({ ...e, ...at });
            }
            present = readable && enough && moved.length === cited.length ? true : null;
            if (present) evidence = f.evidence.map(e => moved.find(m => m.file === e.file && m.snippet === e.snippet) ?? e);
            digest = digestOf(files);
        }

        back ??= present === true;
        let status: RecheckStatus;
        let gone = false;
        if (f.recheck === "fixed") {
            status = back && f.recheckGone ? "regressed" : "fixed";
            gone = status === "fixed" && (f.recheckGone || !back);
        } else if (f.recheck === "open" && (f.recheckDigest === digest || f.recheckDigest === legacy)) status = "open";
        else if (f.recheck === "regressed" && back) status = "regressed";
        else {
            status = present ? "unchanged" : present === false ? "fixed" : "changed";
            gone = status === "fixed";
        }
        const keep = status === "fixed" && f.recheck === "fixed";
        out.push({
            id: f.id,
            label: f.label,
            status,
            digest,
            gone,
            keep,
            ...(evidence ? { evidence } : {}),
            ...(places ? { places } : {})
        });
    }
    return out;
}

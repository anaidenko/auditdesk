import { createHash } from "node:crypto";

import { ASPECTS } from "./aspects";
import { type Evidence, SEVERITIES, type SeverityName } from "./types";

export function findingLabel(n: number): string {
    return `F-${String(n).padStart(3, "0")}`;
}

/**
 * Identifies an issue across runs: line numbers move between commits, so they are left out.
 * Re-audits (v1.1) match on it; v1 uses it to skip scanner findings a re-run already filed.
 */
export function fingerprint(f: {
    repositoryId: string | null;
    aspect: string;
    checklistItem: string | null;
    evidence: Evidence[];
}): string {
    const parts = [
        f.repositoryId,
        f.aspect,
        f.checklistItem ?? "",
        ...f.evidence.map(e => `${e.file}:${(e.snippet ?? "").replace(/\s+/g, " ").trim()}`)
    ];
    return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

/** One line per finding, as the agent sees the ones already filed (design § 6). */
export function indexLine(f: {
    label: string;
    severity: SeverityName | null;
    checklistItem: string | null;
    evidence: Evidence[];
    title: string;
}): string {
    const e = f.evidence[0];
    return `${f.label} [${f.severity ?? "question"}] ${f.checklistItem ?? "-"} ${e ? `${e.file}:${e.startLine}` : "-"} ${f.title}`;
}

/** Whether any of the finding's evidence lies under the path name, as a seams finding's paths do. */
export function cites(evidence: Evidence[], name: string): boolean {
    return evidence.some(e => e.file.startsWith(`${name}/`));
}

const rank = (s: SeverityName | null) => (s === null ? SEVERITIES.length : SEVERITIES.indexOf(s));

/** The catalogue's position of an aspect named by key or title; one outside it sorts last. */
function aspectRank(aspect: string): number {
    const i = ASPECTS.findIndex(a => a.key === aspect || a.title === aspect);
    return i < 0 ? ASPECTS.length : i;
}

export function compareFindings(
    a: { severity: SeverityName | null; aspect: string; number: number },
    b: { severity: SeverityName | null; aspect: string; number: number }
): number {
    return (
        rank(a.severity) - rank(b.severity) ||
        aspectRank(a.aspect) - aspectRank(b.aspect) ||
        a.aspect.localeCompare(b.aspect) ||
        a.number - b.number
    );
}

/** A cited range longer than this locates nothing by itself: a whole file would match every entry in it. */
export const WIDE = 30;

type Placed = {
    label: string;
    source: "agent" | "scanner";
    kind: "finding" | "question";
    checklistItem: string | null;
    evidence: Evidence[];
    cwe?: string | null;
};

/**
 * Scanner findings an agent filed again: the same checklist item, overlapping lines of one file for
 * each of its places, in a range the agent narrowed to at most WIDE lines, and the same CWE when both
 * name one. Each goes into the narrowest agent finding that covers it, which keeps the agent's
 * explanation; one about a single secret never takes a rule's other places with it.
 */
export function scannerDuplicates(agent: Placed[], scanner: Placed[]): { from: string; into: string }[] {
    const span = (e: Evidence) => e.endLine - e.startLine + 1;
    const covers = (a: Placed, y: Evidence) =>
        a.evidence.filter(x => span(x) <= WIDE && x.file === y.file && x.startLine <= y.endLine && y.startLine <= x.endLine).map(span);
    return scanner.flatMap(s => {
        const best = agent
            .filter(
                a =>
                    a.source === "agent" &&
                    a.kind === "finding" &&
                    a.checklistItem === s.checklistItem &&
                    (!a.cwe || !s.cwe || a.cwe === s.cwe)
            )
            .map(a => ({ a, width: Math.max(...s.evidence.map(y => Math.min(...covers(a, y)))) }))
            .filter(x => Number.isFinite(x.width))
            .sort((x, y) => x.width - y.width)[0];
        return best ? [{ from: s.label, into: best.a.label }] : [];
    });
}

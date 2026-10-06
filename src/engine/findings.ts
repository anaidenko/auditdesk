import { createHash } from "node:crypto";

import { type Evidence, SEVERITIES, type SeverityName } from "./types";

export function findingLabel(n: number): string {
    return `F-${String(n).padStart(3, "0")}`;
}

/**
 * Identifies an issue across runs: line numbers move between commits, so they are left out.
 * Re-audits (v1.1) match on it; v1 uses it to skip scanner findings a re-run already filed.
 */
export function fingerprint(f: { repositoryId: string; aspect: string; checklistItem: string | null; evidence: Evidence[] }): string {
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

const rank = (s: SeverityName | null) => (s === null ? SEVERITIES.length : SEVERITIES.indexOf(s));

export function compareFindings(
    a: { severity: SeverityName | null; aspect: string; number: number },
    b: { severity: SeverityName | null; aspect: string; number: number }
): number {
    return rank(a.severity) - rank(b.severity) || a.aspect.localeCompare(b.aspect) || a.number - b.number;
}

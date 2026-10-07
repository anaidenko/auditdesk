import type { Evidence } from "./types";

/**
 * What a re-audit found of a finding reported at an earlier commit (design § 9): still `open`,
 * `fixed`, its cited code `changed` so Andrii must look, or `regressed` after a fix.
 */
export type RecheckStatus = "open" | "fixed" | "changed" | "regressed";

export interface EarlierFinding {
    id: string;
    label: string;
    source: "agent" | "scanner";
    fingerprint: string;
    evidence: Evidence[];
    /** The last re-audit's call, or Andrii's confirmation of it. */
    recheck: RecheckStatus | null;
}

/** The marker `snippetOf` puts on a line it shortened (files.ts). */
const CUT = / … \[line cut: \d+ characters\]$/;

/** Whether the snippet's lines stand together in the file, whatever their indentation or place. */
function holds(fileLines: string[], snippet: string): boolean {
    const want = snippet
        .split("\n")
        .map(l => ({ text: l.replace(CUT, "").trim(), cut: CUT.test(l) }))
        .filter(l => l.text);
    const have = fileLines.map(l => l.trim()).filter(Boolean);
    if (!want.length) return false;
    for (let i = 0; i + want.length <= have.length; i++)
        if (want.every((w, j) => (w.cut ? have[i + j].startsWith(w.text) : have[i + j] === w.text))) return true;
    return false;
}

/**
 * Checks each earlier finding against this run. A scanner's is open while the scanner still
 * reports it and fixed once it does not. An agent's is open while every block it cited is still in
 * its file, or this run's agent filed it again; when the code moved on it is `changed`, since only
 * a reader can tell a fix from a rewrite. A finding confirmed fixed stays fixed until its code or
 * its scanner result returns. `read` gives a file's lines at the new commit, masked like snippets.
 */
export async function recheck(
    earlier: EarlierFinding[],
    o: { scannerSeen: Set<string>; filedNow: Set<string>; read: (file: string) => Promise<string[] | null> }
): Promise<{ id: string; label: string; status: RecheckStatus }[]> {
    const out: { id: string; label: string; status: RecheckStatus }[] = [];
    for (const f of earlier) {
        let present: boolean | null;
        if (f.source === "scanner") present = o.scannerSeen.has(f.fingerprint);
        else if (o.filedNow.has(f.fingerprint)) present = true;
        else {
            const cited = f.evidence.filter(e => e.snippet?.trim());
            let found = 0;
            for (const e of cited) {
                const lines = await o.read(e.file);
                if (lines && holds(lines, e.snippet!)) found++;
            }
            present = cited.length > 0 && found === cited.length ? true : null;
        }
        const fixedBefore = f.recheck === "fixed";
        const status: RecheckStatus = present
            ? fixedBefore
                ? "regressed"
                : "open"
            : fixedBefore || (present === false && f.source === "scanner")
              ? "fixed"
              : "changed";
        out.push({ id: f.id, label: f.label, status });
    }
    return out;
}

import { ASPECTS } from "@/engine/aspects";
import { WIDE } from "@/engine/findings";

import type { AnswerKey, KeyEntry } from "./fixtures";

export interface GradedFinding {
    label: string;
    kind: "finding" | "question";
    source: "agent" | "scanner";
    /** A scanner finding the run folded into an agent's: it can be found, never a leftover. */
    folded?: boolean;
    aspect: string;
    checklistItem: string | null;
    title: string;
    summary?: string;
    evidence: { file: string; startLine: number; endLine: number; snippet?: string }[];
}

export interface Grade {
    matched: { key: string; finding: string }[];
    /** A finding on a key entry's lines under an item the entry does not allow: located, not found. */
    locationOnly: { key: string; finding: string; item: string | null }[];
    /** Findings on a true issue the fixture did not plant: neither found nor false. */
    known: string[];
    /** Findings that match nothing: false findings, unless the judge or Andrii says otherwise. */
    leftovers: string[];
    questionsIgnored: number;
    /** Findings of aspects the run did not choose (a scanner's, on a single-aspect run): not graded. */
    outside: string[];
    /** Entries the run's aspects could find, and how many of them were. */
    scoped: string[];
    total: number;
    found: number;
    /** Entries found by an agent's finding, whatever the scanners found. */
    foundByAgents: number;
    recall: number;
    missed: string[];
}

export { WIDE };

const aspectOf = (item: string | null) => (item === null ? undefined : ASPECTS.find(a => item.startsWith(`${a.prefix}-`))?.key);
const norm = (file: string) => file.replace(/^\.\//, "");

export function places(e: KeyEntry) {
    return [...(e.file ? [{ file: e.file, startLine: e.startLine!, endLine: e.endLine! }] : []), ...(e.also ?? [])];
}

/**
 * The deterministic grade (design § 11), by the rules in the own fixture key's header: a finding
 * matches an entry on the same file, lines overlapping within `slack`, and the entry's item or one
 * of its `alsoItems`; an absence matches by item anywhere; a question entry only by a question.
 */
export function grade(findings: GradedFinding[], key: AnswerKey, o: { slack?: number; aspects?: string[] } = {}): Grade {
    const slack = o.slack ?? 3;
    const inScope = (e: KeyEntry) =>
        !o.aspects || [e.aspect, ...(e.alsoItems ?? []).map(aspectOf)].some(a => a !== undefined && o.aspects!.includes(a));
    const g: Grade = {
        matched: [],
        locationOnly: [],
        known: [],
        leftovers: [],
        questionsIgnored: 0,
        outside: [],
        scoped: [],
        total: 0,
        found: 0,
        foundByAgents: 0,
        recall: 0,
        missed: []
    };

    const located = key.entries.filter(e => e.kind === "finding");
    // Per cited range, the entries at the least distance within the slack: a finding on line 5 is not
    // also credited to a defect planted on line 7.
    const nearest = (entries: KeyEntry[], ev: GradedFinding["evidence"][number]) => {
        const at = entries
            .map(e => ({
                e,
                d: Math.min(
                    ...places(e).map(p =>
                        norm(p.file) === norm(ev.file) ? Math.max(0, p.startLine - ev.endLine, ev.startLine - p.endLine) : Infinity
                    )
                )
            }))
            .filter(x => x.d <= slack);
        const least = Math.min(...at.map(x => x.d));
        return at.filter(x => x.d === least).map(x => x.e.id);
    };

    for (const f of findings) {
        if (o.aspects && !o.aspects.includes(f.aspect) && !o.aspects.includes(aspectOf(f.checklistItem) ?? "")) {
            g.outside.push(f.label);
            continue;
        }
        const allows = (e: KeyEntry) => f.checklistItem !== null && [e.checklistItem, ...(e.alsoItems ?? [])].includes(f.checklistItem);
        const hits = new Set(
            key.entries.filter(e => allows(e) && (e.kind === "absence" || (e.kind === "question" && f.kind === "question"))).map(e => e.id)
        );
        const onPlace = new Set<string>();
        if (f.kind === "finding")
            for (const ev of f.evidence) {
                if (ev.endLine - ev.startLine + 1 > WIDE) continue;
                const near = nearest(located.filter(allows), ev);
                for (const id of near) hits.add(id);
                if (!near.length) for (const id of nearest(located, ev)) onPlace.add(id);
            }
        for (const e of key.entries) if (hits.has(e.id)) g.matched.push({ key: e.id, finding: f.label });
        if (f.folded || hits.size) continue;
        // A known issue is named before a nearby planted entry, which would read it as a misplaced find.
        const known =
            f.kind === "finding" &&
            key.known.some(k => k.checklistItem === f.checklistItem && (!k.file || f.evidence.some(ev => norm(ev.file) === norm(k.file!))));
        if (known) {
            g.known.push(f.label);
            continue;
        }
        for (const e of key.entries) if (onPlace.has(e.id)) g.locationOnly.push({ key: e.id, finding: f.label, item: f.checklistItem });
        if (onPlace.size) continue;
        if (f.kind === "question") g.questionsIgnored++;
        else g.leftovers.push(f.label);
    }

    const scoped = key.entries.filter(inScope);
    const foundIds = new Set(g.matched.map(m => m.key));
    const source = new Map(findings.map(f => [f.label, f.source]));
    const byAgents = new Set(g.matched.filter(m => source.get(m.finding) === "agent").map(m => m.key));
    g.scoped = scoped.map(e => e.id);
    g.total = scoped.length;
    g.found = scoped.filter(e => foundIds.has(e.id)).length;
    g.foundByAgents = scoped.filter(e => byAgents.has(e.id)).length;
    g.recall = g.total ? g.found / g.total : 0;
    g.missed = scoped.filter(e => !foundIds.has(e.id)).map(e => e.id);
    return g;
}

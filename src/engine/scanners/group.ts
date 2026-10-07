import { createHash } from "node:crypto";

import type { Evidence } from "../types";

import type { SampleRole } from "./paths";

/** A place a scanner reported, with its own fingerprint: the next run and the re-check know it by that. */
export type Place = Evidence & { key: string };

/**
 * The places not filed before, each once, in the groups they file under, in the scanner's order.
 * gitleaks reports one secret again for every commit of a file that holds it.
 */
export function groupPlaces<T extends { place: Place }>(items: T[], groupOf: (t: T) => string, known: Set<string> = new Set()): T[][] {
    const seen = new Set(known);
    const groups = new Map<string, T[]>();
    for (const t of items) {
        if (seen.has(t.place.key)) continue;
        seen.add(t.place.key);
        const g = groupOf(t);
        groups.set(g, [...(groups.get(g) ?? []), t]);
    }
    return [...groups.values()];
}

export const comparePlaces = (a: Evidence, b: Evidence) => a.file.localeCompare(b.file) || a.startLine - b.startLine;

/** A group of one keeps its place's fingerprint, which a finding filed before grouping carries too. */
export function groupFingerprint(places: Place[]): string {
    if (places.length === 1) return places[0].key;
    return createHash("sha256")
        .update(["group", ...places.map(p => p.key).sort()].join("\n"))
        .digest("hex")
        .slice(0, 32);
}

/** "one file", "5 files", "3 test files". */
export function filesPhrase(places: Evidence[], role: SampleRole | null): string {
    const n = new Set(places.map(p => p.file)).size;
    return `${n === 1 ? "one" : n} ${role ? `${role} ` : ""}${n === 1 ? "file" : "files"}`;
}

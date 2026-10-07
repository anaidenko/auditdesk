import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

import type { References } from "./types";

/** A link; `url` is null for a value shown as written, such as a CWE the agent gave in a form not understood. */
export interface Ref {
    label: string;
    url: string | null;
}

/** What a finding cites in the report: links only, "relevant to", never "compliant" (design § 10). */
export interface FindingReferences {
    top10: Ref | null;
    cwe: Ref | null;
    asvs: Ref[];
    cheatsheets: Ref[];
    advisories: Ref[];
    nist: Ref | null;
    wcag: Ref[];
}

interface ItemRefs {
    cwe?: number;
    /** A category for an item no single CWE describes, such as "A02:2025". */
    top10?: string;
    asvs?: string[];
    cheatsheets?: string[];
    nist?: boolean;
    /** WCAG 2.2 success criteria, such as "1.1.1", for Accessibility items. */
    wcag?: string[];
}

export interface ReferenceData {
    top10: { id: string; title: string; url: string; cwe: number[] }[];
    asvs: { id: string; title: string; file: string }[];
    wcag: { id: string; title: string; level: string; anchor: string }[];
    mapping: { cheatsheets: Record<string, string>; items: Record<string, ItemRefs> };
}

export function loadReferences(dir = "references"): ReferenceData {
    const read = (f: string) => parse(readFileSync(join(dir, f), "utf8"));
    return {
        top10: (read("top10-2025.yaml") as { categories: ReferenceData["top10"] }).categories,
        asvs: (read("asvs-5.0.0.yaml") as { sections: ReferenceData["asvs"] }).sections,
        wcag: (read("wcag-2.2.yaml") as { criteria: ReferenceData["wcag"] }).criteria,
        mapping: read("mapping.yaml") as ReferenceData["mapping"]
    };
}

const ASVS_TAG = "https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en";
const WCAG_22 = "https://www.w3.org/TR/WCAG22/";
const NIST_800_63B: Ref = {
    label: "NIST SP 800-63B-4 (Digital Identity Guidelines: Authentication)",
    url: "https://pages.nist.gov/800-63-4/sp800-63b.html"
};

function advisory(id: string): Ref {
    const q = encodeURIComponent(id);
    if (id.startsWith("GHSA-")) return { label: id, url: `https://github.com/advisories/${q}` };
    if (id.startsWith("CVE-")) return { label: id, url: `https://www.cve.org/CVERecord?id=${q}` };
    return { label: id, url: `https://osv.dev/vulnerability/${q}` };
}

/** The agent's CWE as it gave it: "CWE-89", "cwe-89", "89" or "CWE-89: SQL Injection" all read as 89. */
function ownCwe(value: string | undefined): number | string | null {
    const v = value?.trim();
    if (!v) return null;
    const n = v.match(/\bCWE[-\s]?0*(\d+)\b/i)?.[1] ?? v.match(/^0*(\d+)$/)?.[1];
    return n ? Number(n) : v;
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens. */
const anchor = (heading: string) =>
    heading
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s/g, "-");

/** A finding's references: its item's mapping and its own CWE and advisories. A question gets no category. */
export function referencesFor(
    data: ReferenceData,
    item: string | null,
    own: References,
    o: { question?: boolean } = {}
): FindingReferences {
    const m = (item && data.mapping.items[item]) || {};
    const given = ownCwe(own.cwe);
    const cweNumber = typeof given === "number" ? given : m.cwe;
    const category = o.question
        ? undefined
        : (cweNumber !== undefined && data.top10.find(c => c.cwe.includes(cweNumber))) || data.top10.find(c => c.id === m.top10);
    const asvs = (m.asvs ?? []).flatMap(id => {
        const section = data.asvs.find(x => x.id === (id.startsWith("V") ? id : `V${id.split(".").slice(0, 2).join(".")}`));
        if (!section) return [];
        const url = `${ASVS_TAG}/${section.file}.md#${anchor(`${section.id} ${section.title}`)}`;
        return [
            id.startsWith("V")
                ? { label: `ASVS 5.0.0 ${section.id} ${section.title}`, url }
                : { label: `ASVS v5.0.0-${id} (${section.id} ${section.title})`, url }
        ];
    });
    return {
        top10: category ? { label: `${category.id} ${category.title}`, url: category.url } : null,
        cwe:
            given === null
                ? null
                : typeof given === "number"
                  ? { label: `CWE-${given}`, url: `https://cwe.mitre.org/data/definitions/${given}.html` }
                  : { label: given, url: null },
        asvs,
        cheatsheets: (m.cheatsheets ?? []).map(name => ({
            label: data.mapping.cheatsheets[name] ?? `${name.replace(/_/g, " ")} Cheat Sheet`,
            url: `https://cheatsheetseries.owasp.org/cheatsheets/${name}_Cheat_Sheet.html`
        })),
        advisories: (own.advisories ?? []).map(advisory),
        nist: m.nist ? NIST_800_63B : null,
        wcag: (m.wcag ?? []).flatMap(id => {
            const c = data.wcag.find(x => x.id === id);
            return c ? [{ label: `WCAG 2.2 SC ${c.id} ${c.title} (Level ${c.level})`, url: `${WCAG_22}#${c.anchor}` }] : [];
        })
    };
}

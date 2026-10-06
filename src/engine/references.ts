import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

import type { References } from "./types";

export interface Ref {
    label: string;
    url: string;
}

/** What a finding cites in the report: links only, "relevant to", never "compliant" (design § 10). */
export interface FindingReferences {
    top10: Ref | null;
    cwe: Ref | null;
    asvs: Ref[];
    cheatsheets: Ref[];
    advisories: Ref[];
    nist: Ref | null;
}

interface ItemRefs {
    cwe?: number;
    asvs?: string[];
    cheatsheets?: string[];
    nist?: boolean;
}

export interface ReferenceData {
    top10: { id: string; title: string; url: string; cwe: number[] }[];
    asvs: { id: string; title: string; file: string }[];
    mapping: { cheatsheets: string[]; items: Record<string, ItemRefs> };
}

export function loadReferences(dir = "references"): ReferenceData {
    const read = (f: string) => parse(readFileSync(join(dir, f), "utf8"));
    return {
        top10: (read("top10-2025.yaml") as { categories: ReferenceData["top10"] }).categories,
        asvs: (read("asvs-5.0.0.yaml") as { sections: ReferenceData["asvs"] }).sections,
        mapping: read("mapping.yaml") as ReferenceData["mapping"]
    };
}

const ASVS_TAG = "https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en";
const NIST_800_63B: Ref = {
    label: "NIST SP 800-63B-4 (Digital Identity Guidelines: Authentication)",
    url: "https://pages.nist.gov/800-63-4/sp800-63b.html"
};

function advisory(id: string): Ref {
    if (id.startsWith("GHSA-")) return { label: id, url: `https://github.com/advisories/${id}` };
    if (id.startsWith("CVE-")) return { label: id, url: `https://www.cve.org/CVERecord?id=${id}` };
    return { label: id, url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}` };
}

/** A finding's references: its item's mapping, with the finding's own CWE and advisories first. */
export function referencesFor(data: ReferenceData, item: string | null, own: References): FindingReferences {
    const m = (item && data.mapping.items[item]) || {};
    const cweNumber = Number(own.cwe?.match(/^CWE-(\d+)$/)?.[1] ?? m.cwe ?? NaN);
    const category = Number.isNaN(cweNumber) ? undefined : data.top10.find(c => c.cwe.includes(cweNumber));
    const asvs = (m.asvs ?? []).flatMap(id => {
        if (id.startsWith("V")) {
            const s = data.asvs.find(x => x.id === id);
            return s ? [{ label: `ASVS 5.0.0 ${s.id} ${s.title}`, url: `${ASVS_TAG}/${s.file}.md` }] : [];
        }
        const s = data.asvs.find(x => x.id === `V${id.split(".").slice(0, 2).join(".")}`);
        return s ? [{ label: `ASVS v5.0.0-${id}`, url: `${ASVS_TAG}/${s.file}.md` }] : [];
    });
    return {
        top10: category ? { label: `${category.id} ${category.title}`, url: category.url } : null,
        cwe: Number.isNaN(cweNumber)
            ? null
            : { label: `CWE-${cweNumber}`, url: `https://cwe.mitre.org/data/definitions/${cweNumber}.html` },
        asvs,
        cheatsheets: (m.cheatsheets ?? []).map(name => ({
            label: `${name.replace(/_/g, " ")} Cheat Sheet`,
            url: `https://cheatsheetseries.owasp.org/cheatsheets/${name}_Cheat_Sheet.html`
        })),
        advisories: (own.advisories ?? []).map(advisory),
        nist: m.nist ? NIST_800_63B : null
    };
}

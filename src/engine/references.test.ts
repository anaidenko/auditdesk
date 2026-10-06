import { describe, expect, it } from "vitest";

import { ASPECTS } from "./aspects";
import { loadChecklist } from "./checklists";
import { loadReferences, referencesFor } from "./references";

const refs = loadReferences();

describe("references", () => {
    it("maps every checklist item of every aspect", async () => {
        for (const a of ASPECTS) {
            for (const item of (await loadChecklist(a.key)).items) expect(refs.mapping.items[item.id], item.id).toBeDefined();
        }
    });

    it("names only Cheat Sheets checked on 2026-10-07, and only ASVS 5.0.0 sections that exist", () => {
        const sections = new Set(refs.asvs.map(s => s.id));
        for (const [item, m] of Object.entries(refs.mapping.items)) {
            for (const c of m.cheatsheets ?? []) expect(Object.keys(refs.mapping.cheatsheets), `${item} ${c}`).toContain(c);
            for (const a of m.asvs ?? [])
                expect(sections, `${item} ${a}`).toContain(a.startsWith("V") ? a : `V${a.split(".").slice(0, 2).join(".")}`);
        }
    });

    it("never uses a CWE MITRE prohibits for mapping", () => {
        expect(Object.values(refs.mapping.items).map(m => m.cwe)).not.toContain(16);
    });

    it("labels a finding by its item's Top 10 category, and prints a weakness only when the finding names one", () => {
        const r = referencesFor(refs, "SEC-04", {});
        expect(r.top10).toEqual({ label: "A05:2025 Injection", url: "https://owasp.org/Top10/2025/A05_2025-Injection/" });
        expect(r.cwe).toBeNull();
        const own = referencesFor(refs, "SEC-04", { cwe: "CWE-918" });
        expect(own.cwe).toEqual({ label: "CWE-918", url: "https://cwe.mitre.org/data/definitions/918.html" });
        expect(own.top10?.label).toBe("A01:2025 Broken Access Control");
    });

    it("reads a finding's own CWE in any common form, and keeps one it cannot read as written", () => {
        for (const cwe of ["cwe-89", "CWE-89 ", "89", "CWE-89: SQL Injection", "CWE-0089"]) {
            expect(referencesFor(refs, "SEC-04", { cwe }).cwe?.label, cwe).toBe("CWE-89");
        }
        expect(referencesFor(refs, "SEC-04", { cwe: "CWE-918 (SSRF)" }).top10?.label).toBe("A01:2025 Broken Access Control");
        expect(referencesFor(refs, "SEC-04", { cwe: "SQL injection" }).cwe).toEqual({ label: "SQL injection", url: null });
    });

    it("takes an item's category from its top10 when no CWE fits the whole item", () => {
        expect(referencesFor(refs, "SEC-11", {}).top10?.label).toBe("A02:2025 Security Misconfiguration");
        expect(referencesFor(refs, "LLM-01", {}).top10).toBeNull();
    });

    it("gives a question no category, only its reading", () => {
        const q = referencesFor(refs, "SEC-10", {}, { question: true });
        expect(q.top10).toBeNull();
        expect(q.cheatsheets.map(c => c.label)).toEqual(["Secrets Management Cheat Sheet"]);
    });

    it("cites ASVS sections and requirements in the standard's own format, linked to their section at the v5.0.0 tag", () => {
        const [req] = referencesFor(refs, "SEC-07", {}).asvs;
        expect(req).toEqual({
            label: "ASVS v5.0.0-1.3.6 (V1.3 Sanitization)",
            url: "https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x10-V1-Encoding-and-Sanitization.md#v13-sanitization"
        });
        expect(referencesFor(refs, "SEC-03", {}).asvs[0].label).toBe("ASVS 5.0.0 V8.2 General Authorization Design");
    });

    it("links Cheat Sheets by their own titles, advisories, and NIST SP 800-63B for authentication only", () => {
        const auth = referencesFor(refs, "SEC-01", {});
        expect(auth.nist?.url).toBe("https://pages.nist.gov/800-63-4/sp800-63b.html");
        expect(auth.cheatsheets[0]).toEqual({
            label: "Authentication Cheat Sheet",
            url: "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html"
        });
        expect(referencesFor(refs, "PRD-05", {}).cheatsheets.map(c => c.label)).toContain("CI/CD Security Cheat Sheet");
        expect(referencesFor(refs, "SEC-03", {}).nist).toBeNull();
        const dep = referencesFor(refs, "DEP-01", { advisories: ["GHSA-grv7-fg5c-xmjg", "CVE-2024-4068", "PYSEC-2024-1"] });
        expect(dep.advisories.map(a => a.url)).toEqual([
            "https://github.com/advisories/GHSA-grv7-fg5c-xmjg",
            "https://www.cve.org/CVERecord?id=CVE-2024-4068",
            "https://osv.dev/vulnerability/PYSEC-2024-1"
        ]);
    });

    it("gives an item with no mapping, or none at all, empty references", () => {
        expect(referencesFor(refs, "QUA-01", {})).toEqual({
            top10: null,
            cwe: null,
            asvs: [],
            cheatsheets: [],
            advisories: [],
            nist: null
        });
        expect(referencesFor(refs, null, {}).asvs).toEqual([]);
    });
});

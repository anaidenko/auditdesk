import { describe, expect, it } from "vitest";

import { forMode, loadChecklist, parseChecklist } from "./checklists";

describe("checklists", () => {
    it("parses item IDs and titles", () => {
        const c = parseChecklist("security", "# Security\n\nIntro.\n\n## SEC-01 Authentication\n\nBody.\n\n## SEC-02 Sessions\n\nBody.\n");
        expect(c.items).toEqual([
            { id: "SEC-01", title: "Authentication", aiBuilt: false },
            { id: "SEC-02", title: "Sessions", aiBuilt: false }
        ]);
    });

    it("refuses a duplicate ID", () => {
        expect(() => parseChecklist("security", "# S\n\n## SEC-01 A\n\n## SEC-01 B\n")).toThrow(/SEC-01/);
    });

    it("refuses an item whose prefix belongs to another aspect", () => {
        expect(() => parseChecklist("security", "# S\n\n## DEP-01 A\n")).toThrow(/DEP-01/);
    });

    it("ships a security checklist numbered SEC-01 to SEC-16 without gaps", async () => {
        const c = await loadChecklist("security");
        expect(c.items.map(i => i.id)).toEqual(Array.from({ length: 16 }, (_, i) => `SEC-${String(i + 1).padStart(2, "0")}`));
    });

    it("marks the AI-built items, and leaves them out unless the mode is on", () => {
        const c = parseChecklist(
            "security",
            "# Security\n\nIntro.\n\n## SEC-01 Authentication\n\nA.\n\n## SEC-02 Missing checks (AI-built)\n\nB.\n"
        );
        expect(c.items.map(i => i.aiBuilt)).toEqual([false, true]);
        const off = forMode(c, false);
        expect(off.items.map(i => i.id)).toEqual(["SEC-01"]);
        expect(off.text).not.toMatch(/SEC-02|Missing checks|B\./);
        expect(off.text).toContain("A.");
        expect(forMode(c, true)).toEqual(c);
    });

    it("ships the AI-built items of design § 7 in Security, Mobile app, Dependencies and Code quality", async () => {
        const built = async (a: string) => (await loadChecklist(a)).items.filter(i => i.aiBuilt).map(i => i.id);
        expect(await built("security")).toEqual(["SEC-16"]);
        expect(await built("mobile")).toEqual(["MOB-14"]);
        expect(await built("dependencies")).toEqual(["DEP-09"]);
        expect(await built("quality")).toEqual(["QUA-08"]);
    });

    it("ships a mobile checklist numbered MOB-01 to MOB-14 that lets native code be read for its bridge surface only", async () => {
        const c = await loadChecklist("mobile");
        expect(c.items.map(i => i.id)).toEqual(Array.from({ length: 14 }, (_, i) => `MOB-${String(i + 1).padStart(2, "0")}`));
        const intro = c.text.slice(0, c.text.indexOf("\n## "));
        expect(intro).toMatch(/Swift, Objective-C, Kotlin (and|or) Java/);
        expect(intro).toMatch(/bridge surface only/);
    });

    it("hands the device's topics to Mobile app from the checklists that run before or beside it", async () => {
        const body = async (aspect: string, id?: string) => {
            const text = (await loadChecklist(aspect)).text;
            if (!id) return text.slice(0, text.indexOf("\n## "));
            const from = text.indexOf(`\n## ${id} `);
            const to = text.indexOf("\n## ", from + 1);
            return text.slice(from, to < 0 ? undefined : to);
        };
        expect(await body("security")).toMatch(/Mobile app aspect runs[^.]*SEC-02[^.]*SEC-10[^.]*SEC-11[^.]*SEC-13/);
        expect(await body("dependencies", "DEP-04")).toMatch(/MOB-10's while Mobile app runs/);
        expect(await body("production", "PRD-08")).toMatch(/While Mobile app runs[^.]*MOB-10[^.]*MOB-12/);
        expect(await body("seams", "SEA-01")).toMatch(/deep link/);
    });

    it("cuts an AI-built item whole, though its body holds a heading-like line in a code block", () => {
        const md = [
            "# Security",
            "",
            "## SEC-01 Authentication",
            "",
            "A.",
            "",
            "## SEC-02 Missing checks (AI-built)",
            "",
            "```ts",
            "## TODO add auth",
            "```",
            "",
            "## SEC-03 Sessions",
            "",
            "C."
        ].join("\n");
        const off = forMode(parseChecklist("security", md), false);
        expect(off.items.map(i => i.id)).toEqual(["SEC-01", "SEC-03"]);
        expect(off.text).not.toMatch(/TODO|```/);
        expect(off.text).toContain("C.");
    });
});

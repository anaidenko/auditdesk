import { describe, expect, it } from "vitest";

import { loadChecklist, parseChecklist } from "./checklists";

describe("checklists", () => {
    it("parses item IDs and titles", () => {
        const c = parseChecklist("security", "# Security\n\nIntro.\n\n## SEC-01 Authentication\n\nBody.\n\n## SEC-02 Sessions\n\nBody.\n");
        expect(c.items).toEqual([
            { id: "SEC-01", title: "Authentication" },
            { id: "SEC-02", title: "Sessions" }
        ]);
    });

    it("refuses a duplicate ID", () => {
        expect(() => parseChecklist("security", "# S\n\n## SEC-01 A\n\n## SEC-01 B\n")).toThrow(/SEC-01/);
    });

    it("refuses an item whose prefix belongs to another aspect", () => {
        expect(() => parseChecklist("security", "# S\n\n## DEP-01 A\n")).toThrow(/DEP-01/);
    });

    it("ships a security checklist numbered SEC-01 to SEC-15 without gaps", async () => {
        const c = await loadChecklist("security");
        expect(c.items.map(i => i.id)).toEqual(Array.from({ length: 15 }, (_, i) => `SEC-${String(i + 1).padStart(2, "0")}`));
    });
});

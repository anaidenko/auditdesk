import { describe, expect, it } from "vitest";

import { ASPECTS, agentCount, aspectTitle, selectAspects } from "./aspects";
import { loadChecklist } from "./checklists";

const intro = (text: string) => text.slice(0, text.indexOf("\n## "));

describe("aspects", () => {
    it("lists security first, then the rest of the catalogue, the seams between repositories last", () => {
        expect(ASPECTS.map(a => a.key)).toEqual([
            "security",
            "dependencies",
            "architecture",
            "data",
            "quality",
            "production",
            "api",
            "performance",
            "accessibility",
            "llm",
            "tenancy",
            "seams"
        ]);
    });

    it("orders a selection by the catalogue and always includes security", () => {
        expect(selectAspects(["quality", "dependencies"])).toEqual({ ok: true, value: ["security", "dependencies", "quality"] });
    });

    it("refuses an aspect outside the catalogue", () => {
        expect(selectAspects(["security", "usability"])).toEqual({ ok: false, error: "Unknown aspect: usability." });
    });

    it("names an aspect by its checklist's title, and an unknown one by its key", () => {
        expect(aspectTitle("data")).toBe("Data model and database");
        expect(aspectTitle("legacy")).toBe("legacy");
    });

    it.each(ASPECTS)("ships the $key checklist under its title, numbered from 01 without gaps, with a severity guide", async a => {
        const c = await loadChecklist(a.key);
        expect(c.title).toBe(a.title);
        expect(c.items.length).toBeGreaterThanOrEqual(5);
        expect(c.items.map(i => i.id)).toEqual(c.items.map((_, i) => `${a.prefix}-${String(i + 1).padStart(2, "0")}`));
        expect(intro(c.text)).toMatch(/^Severity:/m);
    });
});

describe("agentCount", () => {
    it("counts an agent per aspect and repository, and the seams pass once, only across repositories", () => {
        expect(agentCount(2, ["security", "quality"])).toBe(4);
        expect(agentCount(2, ["security", "seams"])).toBe(3);
        expect(agentCount(1, ["security", "seams"])).toBe(1);
    });
});

import { describe, expect, it } from "vitest";

import { loadChecklist, parseChecklist } from "./checklists";
import { SYSTEM_PROMPT, aspectMessage, prefixBlocks } from "./prompts";

describe("prompts", () => {
    it("puts the cache breakpoint on the last block of the shared prefix", () => {
        const blocks = prefixBlocks({ stackProfile: "s", repoMap: "m", brief: "b" });
        expect(blocks.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
        expect(blocks.slice(0, -1).every(b => !b.cache_control)).toBe(true);
    });

    it("keeps the system prompt free of anything that changes between runs", () => {
        expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("grades severity by consequence for every aspect, and leaves the attack scale to security", async () => {
        expect(SYSTEM_PROMPT).not.toMatch(/attacker/);
        expect(SYSTEM_PROMPT).toMatch(/every aspect/);
        expect((await loadChecklist("security")).text).toMatch(/anyone who can reach the app, or sign up for it/);
    });

    it("lists the checklist, the filed findings and the budget for the aspect", () => {
        const checklist = parseChecklist("security", "# Security\n\n## SEC-01 Authentication\n\nBody.\n");
        const text = aspectMessage({ checklist, findingIndex: ["F-001 [high] SEC-10 a.js:2 Secret"], budgetTokens: 120000 });
        expect(text).toContain("## SEC-01 Authentication");
        expect(text).toContain("F-001 [high] SEC-10 a.js:2 Secret");
        expect(text).toContain("120,000 tokens");
    });

    it("names the run's other aspects, after the cache breakpoint, so ownership rules can be followed", () => {
        const checklist = parseChecklist("security", "# Security\n\n## SEC-01 A\n");
        const text = aspectMessage({ checklist, findingIndex: [], budgetTokens: 20000, runAspects: ["Security", "Multi-tenancy"] });
        expect(text).toContain("Aspects in this run: Security, Multi-tenancy.");
    });

    it("words the prompt for an agent of one repository and for the seams pass across several", () => {
        expect(SYSTEM_PROMPT).toContain("of one repository, or for the seams between repositories, of several");
        expect(SYSTEM_PROMPT).not.toMatch(/for this repository/);
        const checklist = parseChecklist("seams", "# Seams\n\n## SEA-01 A\n");
        expect(aspectMessage({ checklist, findingIndex: [], budgetTokens: 20000 })).toContain("# Findings already filed\n");
    });

    it("says when no findings are filed yet", () => {
        const checklist = parseChecklist("security", "# Security\n\n## SEC-01 A\n");
        expect(aspectMessage({ checklist, findingIndex: [], budgetTokens: 20000 })).toContain("None yet.");
    });
});

import { describe, expect, it } from "vitest";

import type { AiPolicySummary } from "./ai-policy";
import { loadChecklist, parseChecklist } from "./checklists";
import { SYSTEM_PROMPT, aspectMessage, briefText, policyText, prefixBlocks } from "./prompts";

const summary: AiPolicySummary = {
    sources: [
        {
            file: ".claude/settings.json",
            tool: "Claude Code",
            patterns: [
                { line: 7, pattern: "Read(./certs/**)" },
                { line: 8, pattern: "Read(~/.aws/**)", note: "outside the repository, not applicable" }
            ],
            excludedFiles: 2
        },
        { file: "packages/api/.cursorignore", tool: "Cursor", nested: true, patterns: [{ line: 1, pattern: "*.pem" }], excludedFiles: 1 },
        { file: ".claudeignore", tool: "no tool (intent)", intent: true, patterns: [{ line: 2, pattern: "drafts/" }], excludedFiles: 0 }
    ],
    warnings: [],
    readsNothing: null,
    files: 40,
    excludedFiles: 3,
    excluded: ["certs/ (2 files)", "packages/api/key.pem"],
    everything: false
};

describe("prompts", () => {
    it("puts the cache breakpoint on the last block of the shared prefix", () => {
        const blocks = prefixBlocks({ stackProfile: "s", repoMap: "m", brief: "b" });
        expect(blocks.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
        expect(blocks.slice(0, -1).every(b => !b.cache_control)).toBe(true);
    });

    it("tells the agents what the client's AI policy excludes and to mark the items it touches partly", () => {
        const text = policyText(summary)!;
        expect(text).toContain("3 of the repository's 40 files");
        expect(text).toContain("- .claude/settings.json (Claude Code): Read(./certs/**)");
        expect(text).not.toContain("~/.aws");
        expect(text).toContain("- packages/api/.cursorignore (Cursor): *.pem");
        expect(text).toContain("- .claudeignore (no tool enforces it; the team's intent): drafts/");
        expect(text).toContain("Excluded: certs/ (2 files), packages/api/key.pem");
        expect(text).toMatch(/"partly"/);
        expect(policyText({ ...summary, sources: [], excludedFiles: 0, excluded: [] })).toBeNull();
    });

    it("puts the policy before the brief, in the cached prefix, and leaves the prefix as it was without one", () => {
        const blocks = prefixBlocks({ stackProfile: "s", repoMap: "m", brief: "b", aiPolicy: "P" });
        expect(blocks.map(b => b.text.split("\n")[0])).toEqual([
            expect.any(String),
            "# Stack profile",
            "m",
            "# The client's AI policy",
            "# Brief from the auditor"
        ]);
        expect(blocks.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
        expect(prefixBlocks({ stackProfile: "s", repoMap: "m", brief: "b", aiPolicy: null })).toEqual(
            prefixBlocks({ stackProfile: "s", repoMap: "m", brief: "b" })
        );
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

describe("briefText", () => {
    it("masks the password of a URL in the brief and the instructions, which every agent's prompt carries", () => {
        const text = briefText(
            { product: "A shop; staging at https://ci:tok3n@staging.example.com/", concerns: null, outOfScope: null, aiBuilt: false },
            "npm start; database postgres://app:Pa55w0rd@localhost:5432/app; cache redis://:s3cretpw@localhost:6379"
        );
        expect(text).toContain("postgres://app:[password masked]@localhost:5432/app");
        expect(text).toContain("https://ci:[password masked]@staging.example.com/");
        expect(text).toContain("redis://:[password masked]@localhost:6379");
        expect(text).not.toMatch(/Pa55w0rd|tok3n|s3cretpw/);
    });
});

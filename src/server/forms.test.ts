import { describe, expect, it } from "vitest";

import { parseBriefForm, parseModelAccess, parseProjectForm, parseRepositoryForm, parseRepositoryNotesForm, parseRunForm } from "./forms";

const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
};

describe("forms", () => {
    it("needs a project name", () => {
        expect(parseProjectForm(fd({ name: "  " }))).toEqual({ ok: false, error: "Name the project." });
    });

    it("reads a repository source and defaults the branch to main", () => {
        expect(parseRepositoryForm(fd({ source: "git@github.com:a/b.git", branch: "" }))).toEqual({
            ok: true,
            value: { source: "git@github.com:a/b.git", branch: "main" }
        });
    });

    it("explains a source it cannot use", () => {
        expect(parseRepositoryForm(fd({ source: "file:///etc", branch: "" }))).toMatchObject({
            ok: false,
            error: expect.stringMatching(/https:\/\//)
        });
    });

    it("refuses a run whose per-agent share is under the task-budget minimum, in thousands", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "10" }), 1)).toMatchObject({
            ok: false,
            error: expect.stringMatching(/20 thousand/)
        });
    });

    it("reads the token cap in thousands, and runs security alone when nothing else is ticked", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "400" }), 1)).toEqual({
            ok: true,
            value: { budgetUsd: 10, budgetTokens: 400_000, aspects: ["security"], model: "claude-sonnet-5-5", effort: "low" }
        });
    });

    it("runs the ticked aspects in the catalogue's order, security always first", () => {
        const f = fd({ budgetUsd: "10", budgetKTokens: "400" });
        f.append("aspects", "quality");
        f.append("aspects", "dependencies");
        expect(parseRunForm(f, 1)).toMatchObject({ ok: true, value: { aspects: ["security", "dependencies", "quality"] } });
    });

    it("refuses an aspect outside the catalogue", () => {
        const f = fd({ budgetUsd: "10", budgetKTokens: "400" });
        f.append("aspects", "performance");
        expect(parseRunForm(f, 1)).toEqual({ ok: false, error: "Unknown aspect: performance." });
    });

    it("splits the token cap over every repository and aspect before checking the minimum", () => {
        const f = fd({ budgetUsd: "10", budgetKTokens: "100" });
        for (const a of ["dependencies", "architecture", "data", "quality", "production"]) f.append("aspects", a);
        expect(parseRunForm(f, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/20 thousand/) });
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "100" }), 1)).toMatchObject({ ok: true });
    });

    it("counts the seams pass as one agent, and none for a project of one repository, as the estimate does", () => {
        const f = (k: string) => {
            const form = fd({ budgetUsd: "10", budgetKTokens: k });
            form.append("aspects", "seams");
            return form;
        };
        expect(parseRunForm(f("60"), 2)).toMatchObject({ ok: true });
        expect(parseRunForm(f("59"), 2)).toMatchObject({ ok: false, error: expect.stringMatching(/^Each of the 3 agents/) });
        expect(parseRunForm(f("20"), 1)).toMatchObject({ ok: true });
    });
});

describe("parseModelAccess", () => {
    it("accepts the two accesses and nothing else", () => {
        const fd = (v: string) => {
            const f = new FormData();
            f.set("modelAccess", v);
            return f;
        };
        expect(parseModelAccess(fd("claude_plan"))).toEqual({ ok: true, value: "claude_plan" });
        expect(parseModelAccess(fd("api_key"))).toEqual({ ok: true, value: "api_key" });
        expect(parseModelAccess(fd("both"))).toEqual({ ok: false, error: "Choose Claude plan or API key." });
    });
});

describe("the run's model and effort", () => {
    it("runs the defaults when the form names none", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "400" }), 1)).toMatchObject({
            ok: true,
            value: { model: "claude-sonnet-5-5", effort: "low" }
        });
    });

    it("runs the model and effort Andrii chose", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "400", model: "claude-opus-5-5", effort: "high" }), 1)).toMatchObject({
            ok: true,
            value: { model: "claude-opus-5-5", effort: "high" }
        });
    });

    it("refuses a model or an effort the picker does not offer", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "400", model: "claude-haiku-4-5" }), 1)).toEqual({
            ok: false,
            error: "Choose one of the offered models."
        });
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "400", effort: "turbo" }), 1)).toEqual({
            ok: false,
            error: "Choose one of the offered efforts."
        });
    });
});

describe("the brief and a repository's notes", () => {
    it("reads the brief, trimmed, and the AI-built flag", () => {
        const f = fd({ product: "  A shop.  ", concerns: "", outOfScope: "Billing" });
        f.set("aiBuilt", "on");
        expect(parseBriefForm(f)).toEqual({
            ok: true,
            value: { product: "A shop.", concerns: null, outOfScope: "Billing", aiBuilt: true }
        });
    });

    it("refuses a field so long it would crowd the agents' prompt", () => {
        expect(parseBriefForm(fd({ product: "x".repeat(4001) }))).toEqual({ ok: false, error: "Keep each field under 4,000 characters." });
        expect(parseRepositoryNotesForm(fd({ stackText: "x".repeat(4001) }))).toEqual({
            ok: false,
            error: "Keep each field under 4,000 characters."
        });
    });

    it("reads a repository's stack profile and instructions", () => {
        expect(parseRepositoryNotesForm(fd({ stackText: " Next.js ", instructions: "", intent: "confirm" }))).toEqual({
            ok: true,
            value: { stackText: "Next.js", instructions: null, confirm: true }
        });
        expect(parseRepositoryNotesForm(fd({ stackText: "Next.js", instructions: "pnpm dev", intent: "instructions" }))).toMatchObject({
            ok: true,
            value: { confirm: false }
        });
    });
});

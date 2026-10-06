import { describe, expect, it } from "vitest";

import { parseModelAccess, parseProjectForm, parseRepositoryForm, parseRunForm } from "./forms";

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

    it("reads the token cap in thousands", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetKTokens: "400" }), 1)).toEqual({
            ok: true,
            value: { budgetUsd: 10, budgetTokens: 400_000 }
        });
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

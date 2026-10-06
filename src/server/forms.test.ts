import { describe, expect, it } from "vitest";

import { parseProjectForm, parseRepositoryForm, parseRunForm } from "./forms";

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

    it("refuses a run whose per-agent share is under the task-budget minimum", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetTokens: "10000" }), 1)).toMatchObject({
            ok: false,
            error: expect.stringMatching(/20,000/)
        });
    });

    it("reads a valid run form", () => {
        expect(parseRunForm(fd({ budgetUsd: "10", budgetTokens: "400000" }), 1)).toEqual({
            ok: true,
            value: { budgetUsd: 10, budgetTokens: 400000 }
        });
    });
});

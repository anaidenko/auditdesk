import { describe, expect, it } from "vitest";

import { runTargets } from "./targets";

const repos = [{ id: "web" }, { id: "api" }];
const agent = (repositoryId: string, aspect: string, status: string) => ({ repositoryId, aspect, status });

describe("runTargets", () => {
    it("lists each repository's aspects, then the seams pass once, under the repository its agent ran in", () => {
        const rows = runTargets(
            repos,
            ["security", "seams"],
            [agent("web", "security", "done"), agent("api", "security", "done"), agent("web", "seams", "done")]
        );
        expect(rows).toEqual([
            { repositoryId: "web", aspect: "security", status: "done" },
            { repositoryId: "api", aspect: "security", status: "done" },
            { repositoryId: "web", aspect: "seams", status: "done" }
        ]);
    });

    it("takes the latest agent of a target, and offers a seams pass that never started under the first repository", () => {
        const rows = runTargets(repos, ["security", "seams"], [agent("web", "security", "failed"), agent("web", "security", "done")]);
        expect(rows).toEqual([
            { repositoryId: "web", aspect: "security", status: "done" },
            { repositoryId: "api", aspect: "security", status: "not started" },
            { repositoryId: "web", aspect: "seams", status: "not started" }
        ]);
    });

    it("has no seams row for a project of one repository, which the pass skips", () => {
        expect(runTargets([{ id: "web" }], ["security", "seams"], [])).toEqual([
            { repositoryId: "web", aspect: "security", status: "not started" }
        ]);
    });
});

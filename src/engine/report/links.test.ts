import { describe, expect, it } from "vitest";

import { repoLinks, webUrl } from "./links";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("repoLinks", () => {
    it("links a GitHub repository, its branch and its commit, from an https or an ssh source", () => {
        const links = {
            repo: "https://github.com/acme/app",
            branch: "https://github.com/acme/app/tree/main",
            commit: `https://github.com/acme/app/commit/${SHA}`
        };
        expect(repoLinks("https://github.com/acme/app.git", "main", SHA)).toEqual(links);
        expect(repoLinks("git@github.com:acme/app.git", "main", SHA)).toEqual(links);
        expect(repoLinks("ssh://git@github.com/acme/app", "main", SHA)).toEqual(links);
    });

    it("never carries the credentials a source URL holds", () => {
        const links = repoLinks("https://x-access-token:ghp_secret@github.com/acme/app.git", "main", SHA);
        expect(links?.repo).toBe("https://github.com/acme/app");
        expect(JSON.stringify(links)).not.toMatch(/ghp_secret|x-access-token/);
    });

    it("links GitLab, subgroups included, and Bitbucket in their own forms", () => {
        expect(repoLinks("https://gitlab.com/acme/platform/api.git", "dev", SHA)).toEqual({
            repo: "https://gitlab.com/acme/platform/api",
            branch: "https://gitlab.com/acme/platform/api/-/tree/dev",
            commit: `https://gitlab.com/acme/platform/api/-/commit/${SHA}`
        });
        expect(repoLinks("git@bitbucket.org:acme/app.git", "main", SHA)).toEqual({
            repo: "https://bitbucket.org/acme/app",
            branch: "https://bitbucket.org/acme/app/src/main",
            commit: `https://bitbucket.org/acme/app/commits/${SHA}`
        });
    });

    it("drops a trailing slash and a .git suffix in any case", () => {
        for (const source of ["https://github.com/acme/app.git/", "https://github.com/acme/app/", "git@github.com:acme/app.GIT"])
            expect(repoLinks(source, "main", SHA)?.repo).toBe("https://github.com/acme/app");
    });

    it("keeps a branch's slashes and encodes the rest of it", () => {
        expect(repoLinks("https://github.com/acme/app", "feature/a b#c", SHA)?.branch).toBe(
            "https://github.com/acme/app/tree/feature/a%20b%23c"
        );
    });

    it("links nothing for a local path or an unknown host, and no commit before a clone", () => {
        expect(repoLinks("/Users/jane/work/app", "main", SHA)).toBeNull();
        expect(repoLinks("https://git.acme.internal/acme/app.git", "main", SHA)).toBeNull();
        expect(repoLinks("https://github.com/acme", "main", SHA)).toBeNull();
        expect(repoLinks("https://github.com/acme/app", "main", null)?.commit).toBeNull();
        expect(repoLinks("https://github.com/acme/app", "main", "not cloned")?.commit).toBeNull();
    });
});

describe("webUrl", () => {
    it("takes an http or https address and nothing else", () => {
        expect(webUrl("https://naidenko.dev")).toBe("https://naidenko.dev/");
        expect(webUrl(" https://naidenko.dev/audit ")).toBe("https://naidenko.dev/audit");
        expect(webUrl("javascript:alert(1)")).toBeNull();
        expect(webUrl("naidenko.dev")).toBeNull();
        expect(webUrl("")).toBeNull();
        expect(webUrl(undefined)).toBeNull();
    });
});

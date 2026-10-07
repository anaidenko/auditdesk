import { describe, expect, it } from "vitest";

import { type GhResult, runIssues } from "./gh-issues";

const drafts = [
    {
        title: "F-002: Raw SQL",
        body: "**Severity:** critical\n\nA query is built from input.\n\n### Details",
        labels: ["audit", "critical"]
    },
    { title: "F-001: Verbose errors", body: "**Severity:** low", labels: ["audit", "low"] },
    { title: "F-003: No rate limit", body: "**Severity:** medium", labels: ["audit", "medium"] }
];

const ok = (stdout = ""): GhResult => ({ status: 0, stdout, stderr: "" });

function harness(o: { visibility?: string; existing?: string[]; failOn?: string; file?: string; gh?: GhResult } = {}) {
    const calls: string[][] = [];
    const out: string[] = [];
    const err: string[] = [];
    const io = {
        read: () => o.file ?? JSON.stringify(drafts),
        out: (l: string) => out.push(l),
        err: (l: string) => err.push(l),
        gh(args: string[]): GhResult {
            calls.push(args);
            if (o.gh) return o.gh;
            if (args[0] === "repo") return ok(JSON.stringify({ visibility: o.visibility ?? "PRIVATE", nameWithOwner: "acme/shop" }));
            if (args[1] === "list") return ok(JSON.stringify((o.existing ?? []).map(title => ({ title }))));
            const title = args[args.indexOf("--title") + 1];
            return title === o.failOn
                ? { status: 1, stdout: "", stderr: "HTTP 403: rate limited" }
                : ok(`https://github.com/acme/shop/issues/${calls.length}`);
        }
    };
    const created = () => calls.filter(c => c[1] === "create").map(c => c[c.indexOf("--title") + 1]);
    return { io, calls, out, err, created, run: (...argv: string[]) => runIssues(argv, io) };
}

describe("pnpm issues:gh", () => {
    it("prints the usage on an unknown flag, a missing repository or -h, and touches nothing", () => {
        for (const argv of [["d.json", "--repo", "acme/shop", "--label"], ["d.json"], ["-h"], ["d.json", "--repo"]]) {
            const h = harness();
            expect(h.run(...argv), argv.join(" ")).toBe(2);
            expect(h.err.join("\n")).toMatch(/pnpm issues:gh <drafts\.json> --repo owner\/name/);
            expect(h.calls).toEqual([]);
        }
    });

    it("refuses a file that is not the Issues JSON export", () => {
        const h = harness({ file: JSON.stringify({ version: "2.1.0", runs: [] }) });
        expect(h.run("d.sarif", "--repo", "acme/shop")).toBe(2);
        expect(h.err.join("\n")).toMatch(/not a list of issue drafts/);
    });

    it("says gh is missing instead of crashing", () => {
        const enoent = Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT" });
        const h = harness({ gh: { status: null, stdout: null, stderr: null, error: enoent } });
        expect(h.run("d.json", "--repo", "acme/shop")).toBe(1);
        expect(h.err.join("\n")).toMatch(/gh is not installed or not on PATH/);
    });

    it("previews the drafts as text, not commands, with the repository's visibility, and creates nothing", () => {
        const h = harness({ existing: ["F-001: Verbose errors"] });
        expect(h.run("d.json", "--repo", "acme/shop", "--labels")).toBe(0);
        const text = h.out.join("\n");
        expect(text).toContain("F-002: Raw SQL\n    labels: audit, critical\n    **Severity:** critical\n    A query is built from input.");
        expect(text).toContain("F-001: Verbose errors (exists, skipped)");
        expect(text).toMatch(/2 issues would be created in acme\/shop \(private\); 1 already exists\. Add --create to create them\./);
        expect(text).not.toMatch(/^gh /m);
        expect(h.created()).toEqual([]);
    });

    it("refuses to publish to a public repository unless --public says so", () => {
        const h = harness({ visibility: "PUBLIC" });
        expect(h.run("d.json", "--repo", "acme/shop", "--create")).toBe(1);
        expect(h.err.join("\n")).toMatch(/acme\/shop is public: anyone could read these findings\. Add --public/);
        expect(h.created()).toEqual([]);
        const p = harness({ visibility: "PUBLIC" });
        expect(p.run("d.json", "--repo", "acme/shop", "--create", "--public")).toBe(0);
        expect(p.created()).toHaveLength(3);
    });

    it("skips the issues that exist, and stops at the first failure saying a re-run picks up the rest", () => {
        const h = harness({ existing: ["F-002: Raw SQL"], failOn: "F-003: No rate limit" });
        expect(h.run("d.json", "--repo", "acme/shop", "--create", "--labels")).toBe(1);
        expect(h.created()).toEqual(["F-001: Verbose errors", "F-003: No rate limit"]);
        expect(h.calls.find(c => c[1] === "create")).toContain("--label");
        expect(h.err.join("\n")).toMatch(
            /Stopped at "F-003: No rate limit": HTTP 403: rate limited\. 1 created\. Run it again: the issues that exist are skipped\./
        );
    });

    it("stops before creating anything when the repository cannot be read", () => {
        const h = harness({ gh: { status: 1, stdout: "", stderr: "Could not resolve to a Repository" } });
        expect(h.run("d.json", "--repo", "acme/shpo", "--create")).toBe(1);
        expect(h.err.join("\n")).toMatch(/acme\/shpo: Could not resolve to a Repository/);
        expect(h.calls).toHaveLength(1);
    });
});

import { describe, expect, it } from "vitest";

import { reportData, reportFinding } from "@/test/report-data";

import { ghIssueCommands, issueDrafts, issuesCsv, sarif } from "./exports";

const data = () =>
    reportData({
        repositories: [
            { name: "app", branch: "main", sha: "0123456789abcdef", notCovered: [] },
            { name: "api", branch: "main", sha: "fedcba9876543210", notCovered: [] }
        ],
        aspects: [
            { title: "Security", status: "done", note: null, coverage: [{ item: "SEC-04", title: "Injection", status: "examined" }] }
        ],
        findings: [
            reportFinding({ label: "F-001", severity: "critical", repository: "app" }),
            reportFinding({
                label: "F-002",
                severity: "low",
                repository: "api",
                title: "Verbose errors",
                checklistItem: "SEC-13",
                evidence: [{ file: "src/err.ts", startLine: 9, endLine: 9 }],
                refs: {
                    top10: { label: "A10:2025 Mishandling of Exceptional Conditions", url: "https://owasp.org/Top10/2025/A10_2025/" },
                    cwe: { label: "CWE-209", url: "https://cwe.mitre.org/data/definitions/209.html" },
                    asvs: [],
                    cheatsheets: [],
                    advisories: [],
                    nist: null
                }
            })
        ],
        questions: [reportFinding({ label: "F-003", severity: null, title: "Who rotates the key?" })]
    });

describe("sarif", () => {
    it("writes SARIF 2.1.0, one run per repository, a result per reported finding and none for a question", () => {
        const log = sarif(data());
        expect(log.version).toBe("2.1.0");
        expect(log.runs.map(r => r.properties.repository)).toEqual(["app", "api"]);
        expect(log.runs.flatMap(r => r.results.map(x => x.properties.label))).toEqual(["F-001", "F-002"]);
        expect(JSON.stringify(log)).not.toContain("Who rotates the key?");
    });

    it("maps severity to level, the item to the rule, and evidence to locations", () => {
        const [app, api] = sarif(data()).runs;
        expect(app.results[0]).toMatchObject({
            ruleId: "SEC-04",
            level: "error",
            locations: [{ physicalLocation: { artifactLocation: { uri: "a.ts" }, region: { startLine: 1, endLine: 2 } } }],
            partialFingerprints: { "auditdesk/finding": "F-001" }
        });
        expect(app.tool.driver.rules).toEqual([expect.objectContaining({ id: "SEC-04", shortDescription: { text: "Injection" } })]);
        expect(api.results[0]).toMatchObject({ ruleId: "SEC-13", level: "note" });
        expect(app.properties.commit).toBe("0123456789abcdef");
    });
});

describe("issue drafts", () => {
    it("writes one issue per reported finding, with its evidence, recommendation and links", () => {
        const [first, second] = issueDrafts(data());
        expect(first.title).toBe("F-001: Raw SQL");
        expect(first.labels).toEqual(["audit", "critical", "security"]);
        expect(first.body).toContain("**Severity:** critical · **Checklist item:** SEC-04 · **Repository:** app");
        expect(first.body).toContain("`a.ts`, lines 1–2");
        expect(first.body).toContain("### Recommendation\n\nr");
        expect(second.body).toContain("[A10:2025 Mishandling of Exceptional Conditions](https://owasp.org/Top10/2025/A10_2025/)");
        expect(issueDrafts(data())).toHaveLength(2);
    });

    it("writes a CSV a tracker can import, quoting every field", () => {
        const csv = issuesCsv(issueDrafts(data()));
        const [header, row] = csv.split("\r\n");
        expect(header).toBe('"Title","Description","Priority","Labels"');
        expect(row.startsWith('"F-001: Raw SQL","**Severity:** critical')).toBe(true);
        expect(row).toContain('"Urgent","audit,critical,security"');
        expect(csv).toContain('q(""<script>alert(1)</script>"")');
    });
});

describe("gh issue commands", () => {
    it("builds one gh issue create per draft, with the body on stdin and labels only when asked", () => {
        const drafts = issueDrafts(data());
        const [plain] = ghIssueCommands(drafts, "acme/shop", { labels: false });
        expect(plain.args).toEqual(["issue", "create", "--repo", "acme/shop", "--title", "F-001: Raw SQL", "--body-file", "-"]);
        expect(plain.stdin).toBe(drafts[0].body);
        const [labelled] = ghIssueCommands(drafts, "acme/shop", { labels: true });
        expect(labelled.args.slice(-6)).toEqual(["--label", "audit", "--label", "critical", "--label", "security"]);
    });

    it("refuses a repository that is not owner/name", () => {
        expect(() => ghIssueCommands([], "shop", { labels: false })).toThrow(/owner\/name/);
    });
});

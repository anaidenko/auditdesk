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
                    nist: null,
                    wcag: []
                }
            })
        ],
        questions: [reportFinding({ label: "F-003", severity: null, title: "Who rotates the key?" })]
    });

const one = (over: Parameters<typeof reportFinding>[0]) => reportData({ findings: [reportFinding(over)] });

describe("sarif", () => {
    it("writes SARIF 2.1.0 for one repository, a result per reported finding and none for a question", () => {
        const log = sarif(data(), "app");
        expect(log.version).toBe("2.1.0");
        expect(log.runs).toHaveLength(1);
        expect(log.runs[0].properties.repository).toBe("app");
        expect(log.runs[0].results.map(x => x.properties.label)).toEqual(["F-001"]);
        expect(sarif(data(), "api").runs[0].results.map(x => x.properties.label)).toEqual(["F-002"]);
        expect(JSON.stringify(log)).not.toContain("Who rotates the key?");
        expect(() => sarif(data(), "web")).toThrow(/No repository "web"/);
    });

    it("marks a draft's run, and each result the auditor has not reviewed yet, in its message as well as its properties", () => {
        const log = sarif(
            reportData({
                draft: true,
                findings: [
                    reportFinding({ label: "F-001", severity: "critical", title: "Raw SQL", summary: "s" }),
                    reportFinding({ label: "F-002", severity: "low", title: "Verbose errors", summary: "s", unreviewed: true })
                ]
            }),
            "app"
        );
        expect(log.runs[0].properties).toMatchObject({ repository: "app", draft: true });
        expect(log.runs[0].results.map(r => [r.message.text, r.properties.unreviewed])).toEqual([
            ["Raw SQL. s", undefined],
            ["Not reviewed yet: Verbose errors. s", true]
        ]);
        expect(sarif(one({}), "app").runs[0].properties).not.toHaveProperty("draft");
    });

    it("maps severity to level, the item to the rule, and evidence to locations under the source root", () => {
        const [app] = sarif(data(), "app").runs;
        expect(app.results[0]).toMatchObject({
            ruleId: "SEC-04",
            level: "error",
            locations: [
                {
                    physicalLocation: {
                        artifactLocation: { uri: "a.ts", uriBaseId: "%SRCROOT%" },
                        region: { startLine: 1, endLine: 2 }
                    }
                }
            ],
            partialFingerprints: { "auditdesk/finding": "F-001" }
        });
        expect(app.tool.driver.rules).toEqual([expect.objectContaining({ id: "SEC-04", shortDescription: { text: "Injection" } })]);
        expect(sarif(data(), "api").runs[0].results[0]).toMatchObject({ ruleId: "SEC-13", level: "note" });
        expect(app.properties.commit).toBe("0123456789abcdef");
    });

    // GitHub reads only a result's first location ("All other values are ignored", its SARIF support page).
    it("gives each place of a scanner finding of several its own result, so each becomes an alert", () => {
        const places = ["a.js", "b.js", "c.js"].map((file, i) => ({ file, startLine: i + 1, endLine: i + 1, key: `k${i}` }));
        const log = sarif(one({ label: "F-007", source: "scanner", evidence: places } as never), "app");
        const results = log.runs[0].results;
        expect(results.map(r => [r.properties.label, r.locations.map(l => l.physicalLocation.artifactLocation.uri)])).toEqual([
            ["F-007", ["a.js"]],
            ["F-007", ["b.js"]],
            ["F-007", ["c.js"]]
        ]);
        expect(results.map(r => r.partialFingerprints["auditdesk/place"])).toEqual(["k0", "k1", "k2"]);
        const agent = sarif(one({ evidence: [places[0], { file: "d.ts", startLine: 1, endLine: 2 }] }), "app").runs[0].results;
        expect(agent).toHaveLength(1);
        expect(agent[0].locations).toHaveLength(2);
    });

    it("marks a security rule for GitHub with the highest severity among its results", () => {
        const d = reportData({
            findings: [
                reportFinding({ label: "F-001", severity: "medium" }),
                reportFinding({ label: "F-002", severity: "critical" }),
                reportFinding({ label: "F-003", severity: "high", checklistItem: "DEP-01" }),
                reportFinding({ label: "F-004", severity: "info", checklistItem: "LLM-02" }),
                reportFinding({ label: "F-005", severity: "high", checklistItem: "QUA-03" })
            ]
        });
        const rules = Object.fromEntries(sarif(d, "app").runs[0].tool.driver.rules.map(r => [r.id, r.properties]));
        expect(rules["SEC-04"]).toEqual({ "tags": ["security"], "security-severity": "9.5" });
        expect(rules["DEP-01"]).toEqual({ "tags": ["security"], "security-severity": "8.0" });
        expect(rules["LLM-02"]).toEqual({ tags: ["security"] });
        expect(rules["QUA-03"]).toBeUndefined();
    });

    it("percent-encodes a path that is not a valid URI as it stands", () => {
        const d = one({ evidence: [{ file: "src/app/[id]/my page%.tsx", startLine: 3, endLine: 3 }] });
        expect(sarif(d, "app").runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
            "src/app/%5Bid%5D/my%20page%25.tsx"
        );
    });

    it("joins the title and the summary with one full stop, and orders results by severity", () => {
        const d = reportData({
            findings: [
                reportFinding({ label: "F-001", severity: "low", title: "Secrets belong in vaults.", summary: "A key is in the code." }),
                reportFinding({ label: "F-002", severity: "critical", title: "Raw SQL" })
            ]
        });
        const results = sarif(d, "app").runs[0].results;
        expect(results.map(r => r.properties.label)).toEqual(["F-002", "F-001"]);
        expect(results[1].message.text).toBe("Secrets belong in vaults. A key is in the code.");
    });

    it("describes a rule by the checklist's title even when its aspect did not run", () => {
        const d = reportData({ itemTitles: { "DEP-01": "Known vulnerabilities" }, findings: [reportFinding({ checklistItem: "DEP-01" })] });
        expect(sarif(d, "app").runs[0].tool.driver.rules[0].shortDescription.text).toBe("Known vulnerabilities");
    });

    it("puts a seams finding in the SARIF of each repository it cites, with that repository's locations only", () => {
        const d = reportData({
            repositories: [
                { name: "acme/web", branch: "main", sha: "a1", notCovered: [] },
                { name: "api", branch: "main", sha: "b2", notCovered: [] }
            ],
            seamsPaths: [
                { path: "web", repository: "acme/web" },
                { path: "api", repository: "api" }
            ],
            findings: [
                reportFinding({
                    label: "F-008",
                    repository: "acme/web",
                    evidence: [{ file: "api/client.ts", startLine: 1, endLine: 1 }]
                }),
                reportFinding({
                    label: "F-009",
                    checklistItem: "SEA-02",
                    aspect: "Seams between repositories",
                    repository: "Seams between repositories",
                    evidence: [
                        { file: "web/src/api.ts", startLine: 3, endLine: 3 },
                        { file: "api/src/routes.ts", startLine: 7, endLine: 8 }
                    ]
                }),
                reportFinding({
                    label: "F-010",
                    checklistItem: "SEA-06",
                    aspect: "Seams between repositories",
                    repository: "Seams between repositories",
                    evidence: [{ file: "web/.env.production", startLine: 1, endLine: 1 }]
                })
            ]
        });
        const uris = (repo: string) =>
            sarif(d, repo).runs[0].results.map(r => [r.properties.label, r.locations.map(l => l.physicalLocation.artifactLocation.uri)]);
        expect(uris("api")).toEqual([["F-009", ["src/routes.ts"]]]);
        expect(uris("acme/web")).toEqual([
            ["F-008", ["api/client.ts"]],
            ["F-009", ["src/api.ts"]],
            ["F-010", [".env.production"]]
        ]);
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

    it("marks a draft's issue the auditor has not reviewed yet, in its title, its first line and its labels", () => {
        const [reviewed, waiting] = issueDrafts(
            reportData({
                draft: true,
                findings: [
                    reportFinding({ label: "F-001", severity: "critical", title: "Raw SQL" }),
                    reportFinding({ label: "F-002", severity: "low", title: "Verbose errors", unreviewed: true })
                ]
            })
        );
        expect(reviewed.title).toBe("F-001: Raw SQL");
        expect(reviewed.body.startsWith("**Severity:**")).toBe(true);
        expect(reviewed.labels).not.toContain("not-reviewed");
        expect(waiting.title).toBe("F-002 (not reviewed): Verbose errors");
        expect(waiting.body.startsWith("**Not reviewed yet:** the auditor has not reviewed this finding")).toBe(true);
        expect(waiting.labels).toEqual(["audit", "low", "security", "not-reviewed"]);
    });

    it("glosses the effort's size in an issue, and gives the hours instead when the export includes them", () => {
        expect(issueDrafts(one({ effort: "M" }))[0].body).toContain(" · **Effort:** M (up to 2 days)");
        expect(issueDrafts(one({ effort: "M", effortHours: { low: 4, high: 6 } }))[0].body).toContain(" · **Effort:** M (4–6 h)");
    });

    it("links an accessibility finding's WCAG criteria in its issue, as the report does", () => {
        const wcag = { label: "WCAG 2.2 SC 2.4.7 Focus Visible (Level AA)", url: "https://www.w3.org/TR/WCAG22/#focus-visible" };
        const [draft] = issueDrafts(
            one({
                checklistItem: "ACC-03",
                refs: { top10: null, cwe: null, asvs: [], cheatsheets: [], advisories: [], nist: null, wcag: [wcag] }
            })
        );
        expect(draft.body).toContain("[WCAG 2.2 SC 2.4.7 Focus Visible (Level AA)](https://www.w3.org/TR/WCAG22/#focus-visible)");
    });

    it("orders the drafts by severity, so the first issue created is the worst", () => {
        const d = reportData({
            findings: [reportFinding({ label: "F-001", severity: "low" }), reportFinding({ label: "F-002", severity: "critical" })]
        });
        expect(issueDrafts(d).map(i => i.title.slice(0, 5))).toEqual(["F-002", "F-001"]);
    });

    it("fences a snippet with more backticks than any run inside it", () => {
        const snippet = 'const p = `Return JSON in\n```json\n{"a": 1}\n```\n`;';
        const [draft] = issueDrafts(one({ evidence: [{ file: "p.ts", startLine: 1, endLine: 5, snippet }] }));
        expect(draft.body).toContain("\n````\n" + snippet + "\n````\n");
    });

    it("escapes Markdown in prose and leaves the model's inline code alone", () => {
        const [draft] = issueDrafts(
            one({
                summary: "a __proto__ key pollutes Object.prototype",
                explanation: "It puts the name into <div> unescaped, across src/**/*.ts; see `req.query.q` and `a_b_c`.",
                recommendation: "# Escape it [now]"
            })
        );
        expect(draft.body).toContain(String.raw`a \_\_proto\_\_ key pollutes Object.prototype`);
        expect(draft.body).toContain(String.raw`into \<div\> unescaped, across src/\*\*/\*.ts; see ` + "`req.query.q` and `a_b_c`.");
        expect(draft.body).toContain(String.raw`\# Escape it \[now\]`);
    });

    it("writes a CSV a tracker can import, quoting every field and separating labels as Linear does", () => {
        const csv = issuesCsv(issueDrafts(data()));
        const [header, row] = csv.split("\r\n");
        expect(header).toBe('"Title","Description","Priority","Labels"');
        expect(row.startsWith('"F-001: Raw SQL","**Severity:** critical')).toBe(true);
        expect(row).toContain('"Urgent","audit, critical, security"');
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

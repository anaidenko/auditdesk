import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { message, replayFetch } from "@/engine/replay";
import { finding, tool } from "@/test/agent-messages";
import { SAMPLE_KEY, makeSampleRepo } from "@/test/sample-repo";

import { type AspectInput, type AspectRunner, apiAspectRunner } from "./agent/run-aspect";
import { git } from "./git";
import { MemorySink } from "./memory-sink";
import { type AuditDeps, type AuditInput, type PipelineSink, pathNames, runAudit } from "./pipeline";
import type { EarlierFinding, RecheckResult } from "./recheck";
import { REPLAY_RULESETS, replayRunner } from "./scanners/replay";
import type { ScannerRunner } from "./scanners/types";
import type { StackProfile } from "./stack";

class TestSink extends MemorySink implements PipelineSink {
    agents: { id: string; aspect: string; status?: string }[] = [];
    stacks: { repositoryId: string; profile: StackProfile }[] = [];
    async repositoryCloned() {}
    async stackDetected(repositoryId: string, profile: StackProfile) {
        this.stacks.push({ repositoryId, profile });
    }
    async toolVersions() {}
    async startAgent(_r: string, aspect: string) {
        const id = `agent-${this.agents.length + 1}`;
        this.agents.push({ id, aspect });
        return id;
    }
    async finishAgent(id: string, outcome: { status: string }) {
        this.agents.find(a => a.id === id)!.status = outcome.status;
    }
    async supersedeUnreviewed(_repositoryId: string | null, _aspect: string) {}
    async earlierFindings(_repositoryId: string | null, _sha: string): Promise<EarlierFinding[]> {
        return [];
    }
    async recheckFindings(_results: RecheckResult[], _sha: string) {}
}

const finish = () =>
    message({
        content: [{ type: "tool_use", id: "t1", name: "finish_aspect", input: { summary: "ok", coverage: [] }, caller: null }],
        stop_reason: "tool_use"
    } as never);

async function audit(
    sink: TestSink,
    source: string,
    workspaceDir: string,
    over: Partial<AuditInput> = {},
    runAspect?: AspectRunner,
    deps: Partial<AuditDeps> = {}
) {
    return runAudit(
        {
            runId: "run",
            projectId: "p",
            model: "claude-opus-5-5",
            effort: "medium",
            budget: { usd: 10, tokens: 400_000 },
            repositories: [{ id: "r", source, branch: "main" }],
            aspects: ["security"],
            ...over
        },
        {
            sink,
            runAspect:
                runAspect ?? apiAspectRunner(new Anthropic({ apiKey: "t", fetch: replayFetch([finish(), finish()]).fetch, maxRetries: 0 })),
            scanners: replayRunner("src/test/fixtures/scanners"),
            fetchRulesets: async () => REPLAY_RULESETS,
            workspaceDir,
            checklistsDir: "checklists",
            ...deps
        }
    );
}

describe("runAudit", () => {
    it("re-checks the earlier reported findings against the new commit before the agents, and says what it found", async () => {
        const repo = await makeSampleRepo();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        const first = new TestSink();
        await audit(first, repo, ws);
        const leak = first.findings.find(f => f.source === "scanner" && f.checklistItem === "SEC-10")!;
        class Rechecking extends TestSink {
            rechecks: { results: RecheckResult[]; sha: string }[] = [];
            override async earlierFindings(r: string | null, sha: string): Promise<EarlierFinding[]> {
                if (r === null) return [];
                expect(sha).toMatch(/^[0-9a-f]{40}$/);
                const base = {
                    references: {},
                    recheck: null,
                    recheckDigest: null,
                    recheckGone: false,
                    checklistItem: "SEC-04",
                    title: "t"
                };
                const agent = (id: string, snippet: string) => ({
                    ...base,
                    id,
                    label: id,
                    source: "agent" as const,
                    fingerprint: `fp-${id}`,
                    evidence: [{ file: "src/server.js", startLine: 7, endLine: 7, snippet }]
                });
                return [
                    {
                        ...base,
                        id: "leak",
                        label: "F-001",
                        source: "scanner",
                        fingerprint: leak.fingerprint,
                        title: leak.title,
                        checklistItem: "SEC-10",
                        evidence: []
                    },
                    {
                        ...base,
                        id: "gone",
                        label: "F-002",
                        source: "scanner",
                        fingerprint: "upgraded-away",
                        title: "left-pad 1.0.0: 1 known vulnerability",
                        checklistItem: "DEP-01",
                        references: { advisories: ["GHSA-none"] },
                        evidence: []
                    },
                    agent("eval", 'app.get("/calc", (req, res) => res.send(String(eval(req.query.expr))));'),
                    agent("rewritten", 'app.get("/calc", (req, res) => res.send(calc(req.query.expr)));')
                ];
            }
            override async recheckFindings(results: RecheckResult[], sha: string) {
                this.rechecks.push({ results, sha });
            }
        }
        const sink = new Rechecking();
        // The earlier scanner findings are known, so this run skips filing them again: the re-check must still see them.
        for (const f of first.findings.filter(f => f.source === "scanner")) await sink.createFinding(f);
        const filed = sink.findings.length;
        await audit(sink, repo, ws);
        expect(sink.findings.filter(f => f.source === "scanner")).toHaveLength(filed);
        expect(sink.rechecks).toHaveLength(1);
        expect(sink.rechecks[0].results.map(r => [r.id, r.status])).toEqual([
            ["leak", "unchanged"],
            ["gone", "fixed"],
            ["eval", "unchanged"],
            ["rewritten", "changed"]
        ]);
        const said = sink.events.findIndex(e => e.startsWith("Re-checked"));
        expect(sink.events[said]).toMatch(
            /^Re-checked 4 earlier findings against [0-9a-f]{7}: 1 fixed \(F-002\), 2 with code unchanged, 1 changed, to verify \(rewritten\)\.$/
        );
        expect(said).toBeLessThan(sink.events.findIndex(e => e.startsWith("Agent:")));
    });

    it("re-checks nothing on a re-run of one aspect", async () => {
        class Counting extends TestSink {
            asked = 0;
            override async earlierFindings() {
                this.asked++;
                return [];
            }
        }
        const sink = new Counting();
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")), {
            only: { repositoryId: "r", aspect: "security" }
        });
        expect(sink.asked).toBe(0);
    });

    it("folds a scanner finding the agent filed again into the agent's, and says so", async () => {
        const sink = new TestSink();
        const evalAtLine7 = finding({
            checklist_item: "SEC-04",
            cwe: "CWE-95",
            title: "User input reaches eval",
            evidence: [{ file: "src/server.js", start_line: 7, end_line: 7 }]
        });
        const runAspect = apiAspectRunner(
            new Anthropic({
                apiKey: "t",
                fetch: replayFetch([tool("report_finding", evalAtLine7), finish(), finish()]).fetch,
                maxRetries: 0
            })
        );
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")), {}, runAspect);
        const agent = sink.findings.find(f => f.source === "agent")!;
        const semgrepEval = sink.findings.find(f => f.source === "scanner" && f.checklistItem === "SEC-04")!;
        expect(semgrepEval.mergedInto).toBe(agent.label);
        expect(sink.events).toContainEqual(`Folded ${semgrepEval.label} into ${agent.label}: the scanner's finding repeats the agent's.`);
        expect(await sink.findingIndex("r")).not.toContainEqual(expect.stringContaining(semgrepEval.label));
    });

    it("goes on with the audit when a fold fails, and says why", async () => {
        class Refusing extends TestSink {
            override async foldScannerDuplicates(): Promise<never> {
                throw new Error("F-004 was already merged or superseded.");
            }
        }
        const sink = new Refusing();
        const result = await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        expect(result.stopped).toBe(false);
        expect(sink.agents.map(a => a.status)).toEqual(["done"]);
        expect(sink.events).toContainEqual("Did not fold the scanner's duplicates: F-004 was already merged or superseded.");
    });

    it("names how many places of a grouped scanner finding are left at a re-check", async () => {
        const repo = await makeSampleRepo();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        const first = new TestSink();
        await audit(first, repo, ws);
        const concat = first.findings.find(f => f.source === "scanner" && f.explanation.includes("code-string-concat"))!;
        class Rechecking extends TestSink {
            override async earlierFindings(r: string | null): Promise<EarlierFinding[]> {
                if (r === null) return [];
                return [
                    {
                        id: "g",
                        label: "F-001",
                        source: "scanner",
                        fingerprint: "a-group",
                        title: concat.title,
                        checklistItem: concat.checklistItem,
                        references: concat.references,
                        recheck: null,
                        recheckDigest: null,
                        recheckGone: false,
                        evidence: [
                            concat.evidence[0],
                            { file: "src/gone.js", startLine: 1, endLine: 1, snippet: "eval(gone)", key: "k-gone" }
                        ]
                    }
                ];
            }
        }
        const sink = new Rechecking();
        await audit(sink, repo, ws);
        expect(sink.events).toContainEqual(expect.stringContaining("1 changed, to verify (F-001: 1 of 2 places left)"));
    });

    it("files a place once, though an earlier finding lists it among several", async () => {
        const repo = await makeSampleRepo();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        const sink = new TestSink();
        await audit(sink, repo, ws);
        const leak = sink.findings.find(f => f.source === "scanner" && f.checklistItem === "SEC-10")!;
        // As if filed in a group of two: the group's fingerprint, the place's own key.
        leak.fingerprint = "a-group";
        leak.evidence = [...leak.evidence, { file: "src/other.js", startLine: 1, endLine: 1, key: "k-other" }];
        const count = sink.findings.length;
        await audit(sink, repo, ws);
        expect(sink.findings.length).toBe(count);
        expect(sink.events).toContainEqual("Scanners filed 0 new findings (1 secret masked from here on).");
    });

    it("counts what the scanners filed and masked in words that fit the count", async () => {
        const sink = new TestSink();
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        expect(sink.events).toContainEqual(expect.stringMatching(/^Scanners filed \d+ new findings \(1 secret masked from here on\)\.$/));
    });

    it("clones, files scanner findings, then runs the security agent", async () => {
        const sink = new TestSink();
        const result = await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        expect(result.stopped).toBe(false);
        expect(sink.findings.filter(f => f.source === "scanner").length).toBeGreaterThanOrEqual(2);
        expect(sink.agents).toEqual([{ id: "agent-1", aspect: "security", status: "done" }]);
    });

    it("shows Semgrep findings with the code itself, not Semgrep's placeholder", async () => {
        const sink = new TestSink();
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        const semgrep = sink.findings.filter(f => f.explanation.startsWith("Semgrep rule"));
        expect(semgrep.length).toBeGreaterThan(0);
        for (const f of semgrep) expect(f.evidence[0].snippet).toContain("eval");
    });

    it("points a dependency finding at its package's entry in the lock file", async () => {
        const sink = new TestSink();
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        const lodash = sink.findings.find(f => f.title.startsWith("lodash "))!;
        expect(lodash.evidence[0].file).toBe("package-lock.json");
        expect(lodash.evidence[0].startLine).toBeGreaterThan(1);
        expect(lodash.evidence[0].snippet).toContain('"node_modules/lodash"');
    });

    it("does not file a scanner finding twice when a run is repeated", async () => {
        const sink = new TestSink();
        const source = await makeSampleRepo();
        const ws = await mkdtemp(join(tmpdir(), "ws-"));
        await audit(sink, source, ws);
        const first = sink.findings.filter(f => f.source === "scanner").length;
        await audit(sink, source, ws);
        expect(sink.findings.filter(f => f.source === "scanner").length).toBe(first);
    });

    it("marks the agent failed when it throws, so it never stays running", async () => {
        const sink = new TestSink();
        sink.recordCall = async () => {
            throw new Error("database gone");
        };
        await expect(audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")))).rejects.toThrow(/database gone/);
        expect(sink.agents).toEqual([{ id: "agent-1", aspect: "security", status: "failed" }]);
    });

    it("starts no agent while the run holds a call it could not price", async () => {
        const sink = new TestSink();
        sink.runSpend = async () => ({ usd: 0.4, freshTokens: 1000, unpriced: true });
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")));
        expect(sink.agents).toEqual([]);
        expect(sink.events.some(e => /^Skipped Security: budget unknown/.test(e))).toBe(true);
    });

    it("starts no agent once Stop has been pressed", async () => {
        const sink = new TestSink();
        sink.stop = true;
        expect(await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")))).toEqual({ stopped: true });
        expect(sink.agents).toEqual([]);
    });
});

/** Records what each agent was given, and finishes it at once. */
function capturing() {
    const inputs: AspectInput[] = [];
    const runAspect: AspectRunner = async o => {
        inputs.push(o);
        return { status: "done", note: null, summary: "ok", coverage: [] };
    };
    return { inputs, runAspect };
}

const prefixText = (o: AspectInput) => o.system.map(b => b.text).join("\n");

describe("the seams pass", () => {
    it("runs one agent over every repository after their own aspects, and files what it finds under none of them", async () => {
        const sink = new TestSink();
        const [web, api] = [await makeSampleRepo(), await makeSampleRepo()];
        const repositories = [
            { id: "r-web", source: web, branch: "main" },
            { id: "r-api", source: api, branch: "main" }
        ];
        const [webName, apiName] = [...pathNames(repositories).values()];
        const inputs: AspectInput[] = [];
        const seamsAgent = apiAspectRunner(
            new Anthropic({
                apiKey: "t",
                fetch: replayFetch([
                    tool("list_files", { dir: ".", glob: "" }),
                    tool(
                        "report_finding",
                        finding({
                            checklist_item: "SEA-01",
                            title: "The front end calls a route the back end serves to anyone",
                            evidence: [
                                { file: `${webName}/src/server.js`, start_line: 4, end_line: 4 },
                                { file: `${apiName}/src/server.js`, start_line: 7, end_line: 7 }
                            ]
                        })
                    ),
                    tool("finish_aspect", { summary: "Done.", coverage: [{ item: "SEA-01", status: "examined" }] })
                ]).fetch,
                maxRetries: 0
            })
        );
        const runAspect: AspectRunner = async o => {
            inputs.push(o);
            return o.ctx.aspect === "seams" ? seamsAgent(o) : { status: "done", note: null, summary: "ok", coverage: [] };
        };
        await audit(sink, web, await mkdtemp(join(tmpdir(), "ws-")), { repositories, aspects: ["security", "seams"] }, runAspect);
        expect(inputs.map(i => [i.ctx.aspect, i.ctx.repositoryId])).toEqual([
            ["security", "r-web"],
            ["security", "r-api"],
            ["seams", "r-web"]
        ]);
        // Three agents share the budget: the seams pass is one, not one per repository.
        expect(inputs[0].share.usd).toBeCloseTo(10 / 3);
        const seams = inputs[2];
        expect(seams.ctx.roots?.map(r => r.name)).toEqual([webName, apiName]);
        expect(prefixText(seams)).toContain(`## ${webName}`);
        expect(prefixText(seams)).toContain(`## ${apiName}`);
        const filed = sink.findings.find(f => f.checklistItem === "SEA-01")!;
        expect(filed.repositoryId).toBeNull();
        expect(filed.evidence.map(e => e.file)).toEqual([`${webName}/src/server.js`, `${apiName}/src/server.js`]);
        expect(sink.events).toContainEqual(expect.stringMatching(/^Agent: Seams between repositories/));
    });

    it("re-runs the seams pass alone, replacing its unreviewed findings", async () => {
        class Superseding extends TestSink {
            superseded: [string | null, string][] = [];
            override async supersedeUnreviewed(repositoryId: string | null, aspect: string) {
                this.superseded.push([repositoryId, aspect]);
            }
        }
        const sink = new Superseding();
        const { inputs, runAspect } = capturing();
        const repositories = [
            { id: "r-web", source: await makeSampleRepo(), branch: "main" },
            { id: "r-api", source: await makeSampleRepo(), branch: "main" }
        ];
        await sink.createFinding({
            repositoryId: null,
            agentRunId: null,
            aspect: "seams",
            kind: "finding",
            checklistItem: "SEA-01",
            title: "Reviewed before the re-run",
            severity: "medium",
            likelihood: null,
            impact: null,
            summary: "s",
            explanation: "e",
            recommendation: "r",
            effort: "S",
            effortHours: null,
            evidence: [],
            references: {},
            tags: [],
            source: "agent",
            fingerprint: "reviewed"
        });
        await audit(
            sink,
            repositories[0].source,
            await mkdtemp(join(tmpdir(), "ws-")),
            { repositories, aspects: ["security", "seams"], only: { repositoryId: "r-web", aspect: "seams" } },
            runAspect
        );
        expect(inputs.map(i => i.ctx.aspect)).toEqual(["seams"]);
        expect(inputs[0].ctx.roots).toHaveLength(2);
        expect(sink.superseded).toEqual([[null, "seams"]]);
        expect(inputs[0].firstMessage).toContain("F-001 [medium] SEA-01 - Reviewed before the re-run");
    });

    it("gives the seams pass its earlier findings, and each repository's agents those that cite it", async () => {
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        const repositories = [
            { id: "r-web", source: await makeSampleRepo(), branch: "main" },
            { id: "r-api", source: await makeSampleRepo(), branch: "main" }
        ];
        const [webName] = [...pathNames(repositories).values()];
        await sink.createFinding({
            repositoryId: null,
            agentRunId: null,
            aspect: "seams",
            kind: "finding",
            checklistItem: "SEA-02",
            title: "The admin route trusts the front end's check",
            severity: "high",
            likelihood: null,
            impact: null,
            summary: "s",
            explanation: "e",
            recommendation: "r",
            effort: "S",
            effortHours: null,
            evidence: [{ file: `${webName}/src/server.js`, startLine: 4, endLine: 4 }],
            references: {},
            tags: [],
            source: "agent",
            fingerprint: "seam"
        });
        await audit(
            sink,
            repositories[0].source,
            await mkdtemp(join(tmpdir(), "ws-")),
            { repositories, aspects: ["security", "seams"] },
            runAspect
        );
        const [web, api, seams] = inputs.map(i => i.firstMessage);
        expect(web).toContain(`Across repositories: F-001 [high] SEA-02 ${webName}/src/server.js:4`);
        expect(api).not.toContain("F-001");
        expect(seams).toContain(`F-001 [high] SEA-02 ${webName}/src/server.js:4 The admin route trusts the front end's check`);
    });

    it("re-checks the seams pass's earlier findings in every repository's clone, before the agents, at the commits joined", async () => {
        const repositories = [
            { id: "r-web", source: await makeSampleRepo(), branch: "main" },
            { id: "r-api", source: await makeSampleRepo(), branch: "main" }
        ];
        const [webName, apiName] = [...pathNames(repositories).values()];
        const asked: (string | null)[] = [];
        class Rechecking extends TestSink {
            rechecks: { results: RecheckResult[]; sha: string }[] = [];
            override async earlierFindings(repositoryId: string | null): Promise<EarlierFinding[]> {
                asked.push(repositoryId);
                if (repositoryId !== null) return [];
                const line = (file: string, snippet: string) => ({ file, startLine: 7, endLine: 7, snippet });
                const seam = (id: string, evidence: EarlierFinding["evidence"]) => ({
                    id,
                    label: id,
                    source: "agent" as const,
                    fingerprint: id,
                    title: "t",
                    checklistItem: "SEA-02",
                    references: {},
                    evidence,
                    recheck: null,
                    recheckDigest: null,
                    recheckGone: false
                });
                const calc = 'app.get("/calc", (req, res) => res.send(String(eval(req.query.expr))));';
                return [
                    seam("both", [line(`${webName}/src/server.js`, calc), line(`${apiName}/src/server.js`, calc)]),
                    seam("moved-on", [line(`${apiName}/src/server.js`, 'app.get("/calc", (req, res) => res.send(calc(req.query.expr)));')]),
                    seam("unknown-root", [line(`gone/src/server.js`, calc)])
                ];
            }
            override async recheckFindings(results: RecheckResult[], sha: string) {
                this.rechecks.push({ results, sha });
            }
        }
        const sink = new Rechecking();
        const { runAspect } = capturing();
        await audit(
            sink,
            repositories[0].source,
            await mkdtemp(join(tmpdir(), "ws-")),
            { repositories, aspects: ["security", "seams"] },
            runAspect
        );
        expect(asked).toEqual([null, "r-web", "r-api"]);
        const shas = await Promise.all(repositories.map(async r => (await git(["rev-parse", "HEAD"], r.source)).trim()));
        expect(sink.rechecks).toEqual([
            {
                sha: `${shas[0]}+${shas[1]}`,
                results: [
                    expect.objectContaining({ id: "both", status: "unchanged" }),
                    expect.objectContaining({ id: "moved-on", status: "changed" }),
                    expect.objectContaining({ id: "unknown-root", status: "changed" })
                ]
            }
        ]);
        const said = sink.events.findIndex(e => e.startsWith("Re-checked 3 earlier findings of the seams pass"));
        expect(said).toBeGreaterThan(-1);
        expect(said).toBeLessThan(sink.events.findIndex(e => e.startsWith("Agent:")));
    });

    it("skips the seams pass for a project of one repository, and gives its share to the others", async () => {
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")), { aspects: ["security", "seams"] }, runAspect);
        expect(inputs.map(i => i.ctx.aspect)).toEqual(["security"]);
        expect(inputs[0].share.usd).toBeCloseTo(10);
        expect(sink.events).toContain("Skipped Seams between repositories: the project has one repository.");
    });

    it("names repositories for paths, told apart by branch and then by number", () => {
        const names = pathNames([
            { id: "a", source: "https://github.com/acme/shop.git", branch: "main" },
            { id: "b", source: "/work/shop", branch: "release/2" },
            { id: "c", source: "/work/api/", branch: "main" },
            { id: "d", source: "git@github.com:acme/api.git", branch: "main" }
        ]);
        expect([...names.values()]).toEqual(["shop-main", "shop-release-2", "api-main", "api-2"]);
    });
});

describe("the cached prefix", () => {
    it("detects the stack when none is confirmed, records it, and gives it to the agents", async () => {
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        await audit(sink, await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")), {}, runAspect);
        expect(sink.stacks.map(s => s.repositoryId)).toEqual(["r"]);
        expect(sink.stacks[0].profile.frameworks).toEqual(expect.arrayContaining([expect.stringMatching(/^Express/)]));
        expect(prefixText(inputs[0])).toMatch(/Frameworks: .*Express/);
        expect(prefixText(inputs[0])).toMatch(/not confirmed/);
    });

    it("uses the confirmed stack as the auditor wrote it, without detecting again", async () => {
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        const source = await makeSampleRepo();
        await audit(
            sink,
            source,
            await mkdtemp(join(tmpdir(), "ws-")),
            { repositories: [{ id: "r", source, branch: "main", stackText: "Express 4 on Node.js 22; PostgreSQL through pg." }] },
            runAspect
        );
        expect(sink.stacks).toEqual([]);
        expect(prefixText(inputs[0])).toContain("Express 4 on Node.js 22; PostgreSQL through pg.");
        expect(prefixText(inputs[0])).not.toMatch(/not confirmed/);
    });

    it("puts the brief and the repository's instructions in the prefix, masked", async () => {
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        const source = await makeSampleRepo();
        await audit(
            sink,
            source,
            await mkdtemp(join(tmpdir(), "ws-")),
            {
                brief: {
                    product: "A calculator API for schools.",
                    concerns: `The key ${SAMPLE_KEY} leaked once.`,
                    outOfScope: null,
                    aiBuilt: false
                },
                repositories: [{ id: "r", source, branch: "main", instructions: "npm start; listens on :3000." }]
            },
            runAspect
        );
        const text = prefixText(inputs[0]);
        expect(text).toContain("A calculator API for schools.");
        expect(text).toContain("npm start; listens on :3000.");
        expect(text).not.toContain(SAMPLE_KEY);
    });

    it("keeps the prefix byte-identical across the aspects of one repository", async () => {
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        await audit(
            sink,
            await makeSampleRepo(),
            await mkdtemp(join(tmpdir(), "ws-")),
            { aspects: ["security", "quality"], brief: { product: "p", concerns: null, outOfScope: null, aiBuilt: false } },
            runAspect
        );
        expect(inputs.map(i => i.ctx.aspect)).toEqual(["security", "quality"]);
        expect(JSON.stringify(inputs[1].system)).toBe(JSON.stringify(inputs[0].system));
    });

    it("runs every aspect of every repository, splitting the budget evenly between them", async () => {
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        const [web, api] = [await makeSampleRepo(), await makeSampleRepo()];
        await audit(
            sink,
            web,
            await mkdtemp(join(tmpdir(), "ws-")),
            {
                aspects: ["security", "quality"],
                repositories: [
                    { id: "web", source: web, branch: "main" },
                    { id: "api", source: api, branch: "main" }
                ]
            },
            runAspect
        );
        expect(inputs.map(i => `${i.ctx.repositoryId}:${i.ctx.aspect}`)).toEqual([
            "web:security",
            "web:quality",
            "api:security",
            "api:quality"
        ]);
        expect(inputs.map(i => i.share.tokens)).toEqual([100_000, 100_000, 100_000, 100_000]);
        expect(inputs.map(i => i.share.usd)).toEqual([2.5, 2.5, 2.5, 2.5]);
    });

    it("gives the agent the AI-built items only when the mode is on", async () => {
        const runWith = async (aiBuilt: boolean) => {
            const { inputs, runAspect } = capturing();
            await audit(
                new TestSink(),
                await makeSampleRepo(),
                await mkdtemp(join(tmpdir(), "ws-")),
                { brief: { product: null, concerns: null, outOfScope: null, aiBuilt } },
                runAspect
            );
            return inputs[0];
        };
        const [off, on] = [await runWith(false), await runWith(true)];
        expect(off.firstMessage).not.toMatch(/SEC-16/);
        expect(off.ctx.checklist.items.map(i => i.id)).not.toContain("SEC-16");
        expect(on.firstMessage).toMatch(/SEC-16/);
    });

    it("never changes the shared prefix with the AI-built mode, and tells the agent in its own message", async () => {
        const run = async (aiBuilt: boolean) => {
            const { inputs, runAspect } = capturing();
            await audit(
                new TestSink(),
                await makeSampleRepo(),
                await mkdtemp(join(tmpdir(), "ws-")),
                { brief: { product: "p", concerns: null, outOfScope: null, aiBuilt } },
                runAspect
            );
            return inputs[0];
        };
        const [off, on] = [await run(false), await run(true)];
        expect(JSON.stringify(on.system)).toBe(JSON.stringify(off.system));
        expect(on.firstMessage).toMatch(/largely AI-built/);
        expect(off.firstMessage).not.toMatch(/AI-built/);
    });

    it("leaves the shared prefix as it was when the AI-built mode is off and no brief is written", async () => {
        const prefix = async (over: Partial<AuditInput>) => {
            const { inputs, runAspect } = capturing();
            await audit(new TestSink(), await makeSampleRepo(), await mkdtemp(join(tmpdir(), "ws-")), over, runAspect);
            return JSON.stringify(inputs[0].system);
        };
        expect(await prefix({ brief: { product: null, concerns: null, outOfScope: null, aiBuilt: false } })).toBe(await prefix({}));
    });

    it("masks the brief with the secrets of every repository, before any agent starts", async () => {
        const recorded = replayRunner("src/test/fixtures/scanners");
        // gitleaks finds the key only in web; api's agents run first and must not see it in the brief.
        const onlyWeb: ScannerRunner = {
            ...recorded,
            run: async (tool, args, mounts) =>
                tool === "gitleaks" && !mounts.some(m => m.host.includes("/web@"))
                    ? { stdout: "[]", stderr: "", exitCode: 0 }
                    : recorded.run(tool, args, mounts)
        };
        const { inputs, runAspect } = capturing();
        const [api, web] = [await makeSampleRepo(), await makeSampleRepo()];
        await audit(
            new TestSink(),
            api,
            await mkdtemp(join(tmpdir(), "ws-")),
            {
                brief: { product: null, concerns: `The key ${SAMPLE_KEY} leaked once.`, outOfScope: null, aiBuilt: false },
                repositories: [
                    { id: "api", source: api, branch: "main" },
                    { id: "web", source: web, branch: "main" }
                ]
            },
            runAspect,
            { scanners: onlyWeb }
        );
        expect(inputs.map(i => i.ctx.repositoryId)).toEqual(["api", "web"]);
        for (const i of inputs) expect(prefixText(i), i.ctx.repositoryId).not.toContain(SAMPLE_KEY);
    });

    it("re-runs one repository's aspect after gitleaks alone on the others, and files nothing for them", async () => {
        const recorded = replayRunner("src/test/fixtures/scanners");
        const calls: string[] = [];
        const counting: ScannerRunner = {
            ...recorded,
            run: async (tool, args, mounts) => {
                calls.push(`${tool}:${mounts[0].host.includes("/web@") ? "web" : "api"}`);
                return recorded.run(tool, args, mounts);
            }
        };
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        const [api, web] = [await makeSampleRepo(), await makeSampleRepo()];
        await audit(
            sink,
            api,
            await mkdtemp(join(tmpdir(), "ws-")),
            {
                repositories: [
                    { id: "api", source: api, branch: "main" },
                    { id: "web", source: web, branch: "main" }
                ],
                only: { repositoryId: "web", aspect: "security" }
            },
            runAspect,
            { scanners: counting }
        );
        expect(calls).toEqual(["gitleaks:api", "gitleaks:web", "osv:web", "semgrep:web"]);
        expect(inputs.map(i => `${i.ctx.repositoryId}:${i.ctx.aspect}`)).toEqual(["web:security"]);
        expect(sink.findings.every(f => f.repositoryId === "web")).toBe(true);
    });

    it("re-runs the seams pass after gitleaks alone on every repository, filing nothing from the scanners", async () => {
        const recorded = replayRunner("src/test/fixtures/scanners");
        const calls: string[] = [];
        const counting: ScannerRunner = {
            ...recorded,
            run: async (tool, args, mounts) => {
                calls.push(`${tool}:${mounts[0].host.includes("/web@") ? "web" : "api"}`);
                return recorded.run(tool, args, mounts);
            }
        };
        const sink = new TestSink();
        const { inputs, runAspect } = capturing();
        const [api, web] = [await makeSampleRepo(), await makeSampleRepo()];
        await audit(
            sink,
            api,
            await mkdtemp(join(tmpdir(), "ws-")),
            {
                repositories: [
                    { id: "api", source: api, branch: "main" },
                    { id: "web", source: web, branch: "main" }
                ],
                aspects: ["security", "seams"],
                only: { repositoryId: "api", aspect: "seams" }
            },
            runAspect,
            { scanners: counting }
        );
        expect(calls).toEqual(["gitleaks:api", "gitleaks:web"]);
        expect(inputs.map(i => i.ctx.aspect)).toEqual(["seams"]);
        expect(inputs[0].ctx.roots).toHaveLength(2);
        expect(sink.findings).toEqual([]);
        expect(sink.events.some(e => e.startsWith("Scanners filed"))).toBe(false);
    });
});

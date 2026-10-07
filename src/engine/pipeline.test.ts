import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { message, replayFetch } from "@/engine/replay";
import { SAMPLE_KEY, makeSampleRepo } from "@/test/sample-repo";

import { type AspectInput, type AspectRunner, apiAspectRunner } from "./agent/run-aspect";
import { MemorySink } from "./memory-sink";
import { type AuditDeps, type AuditInput, type PipelineSink, runAudit } from "./pipeline";
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
    async supersedeUnreviewed() {}
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
});

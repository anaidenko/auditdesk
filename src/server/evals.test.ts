import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadChecks, loadEvalRows, saveCheck } from "@/server/evals";

afterEach(() => vi.unstubAllEnvs());

const result = (fixture: string, date: string, found: number) =>
    `# Eval: ${fixture}, claude-sonnet-5-5 at low\n\n- **Date:** ${date}\n- **Aspects:** security\n- **Duration:** 9 s; **calls:** 2; **cache-read share:** 0%\n\n**${found} of 18** key entries found (0%); agents alone: 0 of 18.\n\nAgents: $0.10.\n`;

describe("loadEvalRows", () => {
    it("reads every result in the folder, newest first, and skips other files", async () => {
        const dir = await mkdtemp(join(tmpdir(), "results-"));
        await writeFile(join(dir, "a.md"), result("juice-shop", "2026-10-07T05:00:00Z", 2));
        await writeFile(join(dir, "b.md"), result("own", "2026-10-08T05:00:00Z", 9));
        await writeFile(join(dir, "notes.md"), "# Notes\n");
        await writeFile(join(dir, "c.json"), "{}");
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", dir);
        expect((await loadEvalRows()).map(r => [r.file, r.found])).toEqual([
            ["b.md", 9],
            ["a.md", 2]
        ]);
    });

    it("reads nothing, without an error, when the folder does not exist", async () => {
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", join(tmpdir(), "no-such-folder-for-evals"));
        expect(await loadEvalRows()).toEqual([]);
    });
});

describe("spot-checks", () => {
    it("keeps Andrii's call on each judged finding beside the result, and reads it back", async () => {
        const dir = await mkdtemp(join(tmpdir(), "results-"));
        await writeFile(join(dir, "a.md"), result("juice-shop", "2026-10-07T05:00:00Z", 2));
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", dir);
        await saveCheck("a.md", "F-004", { agree: false, note: "It is parameterised, but the judge missed the raw branch." });
        await saveCheck("a.md", "F-007", { agree: true, note: "" });
        const checks = await loadChecks("a.md");
        expect(checks["F-004"]).toMatchObject({ agree: false, note: "It is parameterised, but the judge missed the raw branch." });
        expect(checks["F-007"]).toMatchObject({ agree: true });
        expect(Object.keys(checks)).toHaveLength(2);
    });

    it("refuses a file outside the results folder, a file that is not a result, and an odd label", async () => {
        const dir = await mkdtemp(join(tmpdir(), "results-"));
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", dir);
        await expect(saveCheck("../a.md", "F-001", { agree: true, note: "" })).rejects.toThrow(/result file/);
        await expect(saveCheck("missing.md", "F-001", { agree: true, note: "" })).rejects.toThrow(/result file/);
        await writeFile(join(dir, "a.md"), result("own", "2026-10-07T05:00:00Z", 1));
        await expect(saveCheck("a.md", "F-1; rm", { agree: true, note: "" })).rejects.toThrow(/finding label/);
    });
});

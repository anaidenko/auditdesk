import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEvalRows } from "@/server/evals";

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

import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadChecks, loadEvalRows, saveCheck } from "@/server/evals";

afterEach(() => vi.unstubAllEnvs());

const result = (fixture: string, date: string, found: number) =>
    `# Eval: ${fixture}, claude-sonnet-5-5 at low\n\n- **Date:** ${date}\n- **Aspects:** security\n- **Duration:** 9 s; **calls:** 2; **cache-read share:** 0%\n\n## Recall\n\n**${found} of 18** key entries found (0%); agents alone: 0 of 18.\n\n## Cost\n\nAgents: $0.10.\n`;

describe("loadEvalRows", () => {
    it("reads every result in the folder, newest first, and names the Markdown files it could not read", async () => {
        const dir = await mkdtemp(join(tmpdir(), "results-"));
        await writeFile(join(dir, "a.md"), result("juice-shop", "2026-10-07T05:00:00Z", 2));
        await writeFile(join(dir, "b.md"), result("own", "2026-10-08T05:00:00Z", 9));
        await writeFile(join(dir, "notes.md"), "# Notes\n");
        await writeFile(join(dir, "c.json"), "{}");
        await mkdir(join(dir, "drafts.md"));
        await symlink(join(dir, "gone.md"), join(dir, "link.md"));
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", dir);
        const { rows, skipped } = await loadEvalRows();
        expect(rows.map(r => [r.file, r.found])).toEqual([
            ["b.md", 9],
            ["a.md", 2]
        ]);
        expect(skipped).toEqual(["drafts.md", "link.md", "notes.md"]);
    });

    it("reads nothing, without an error, when the folder does not exist", async () => {
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", join(tmpdir(), "no-such-folder-for-evals"));
        expect(await loadEvalRows()).toEqual({ rows: [], skipped: [], brokenReviews: [] });
    });

    it("fails when the folder is there but cannot be read, instead of showing no results", async () => {
        const file = join(await mkdtemp(join(tmpdir(), "results-")), "not-a-folder");
        await writeFile(file, "");
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", file);
        await expect(loadEvalRows()).rejects.toThrow(/ENOTDIR/);
    });
});

describe("spot-checks", () => {
    const judged = (verdicts: string[], tally = verdicts.length) =>
        result("own", "2026-10-07T05:00:00Z", 6).replace(
            "## Cost",
            [
                "## Findings outside the key",
                "",
                `**False findings: 1** by the judge's verdicts, of ${tally} it was given.`,
                "",
                ...verdicts,
                "Questions outside the key: 0.",
                "",
                `Judge: ${tally} verdicts: ${tally} false. Cost $0.01.`,
                "",
                "## Cost"
            ].join("\n")
        );
    const F004 = "- F-004 (SEC-04, src/db.ts:5): Raw SQL — judge: false; Parameterised.";
    const F007 = "- F-007 (SEC-03, src/a.ts:9): No owner check — judge: false; The route checks it upstream.";
    const F009 = "- F-009 (SEC-05, src/b.ts:2): XSS — judge: unsure; Not judged: the judge's cap was reached.";

    async function folder(files: Record<string, string>) {
        const dir = await mkdtemp(join(tmpdir(), "results-"));
        for (const [f, text] of Object.entries(files)) await writeFile(join(dir, f), text);
        vi.stubEnv("AUDITDESK_EVAL_RESULTS", dir);
        return dir;
    }

    it("keeps Andrii's call on each judged finding beside the result, and counts the checked and the agreed", async () => {
        await folder({ "a.md": judged([F004, F007, F009]) });
        await saveCheck("a.md", "F-004", { agree: false, note: "It is parameterised, but the judge missed the raw branch." });
        await saveCheck("a.md", "F-007", { agree: true, note: "" });
        const checks = await loadChecks("a.md");
        expect(checks["F-004"]).toMatchObject({
            agree: false,
            note: "It is parameterised, but the judge missed the raw branch.",
            verdict: "false",
            title: "Raw SQL"
        });
        expect((await loadEvalRows()).rows[0]).toMatchObject({ judged: 2, checked: 2, agreed: 1, notJudged: 1, unreadable: 0 });
    });

    it("refuses a file outside the folder, a file that is not a result, and a label without a verdict to check", async () => {
        const dir = await folder({ "notes.md": "# Notes\n", "a.md": judged([F004, F009]) });
        await writeFile(join(dir, "..", "a.md"), judged([F004]));
        await expect(saveCheck("../a.md", "F-004", { agree: true, note: "" })).rejects.toThrow(/result file/);
        await expect(saveCheck("missing.md", "F-004", { agree: true, note: "" })).rejects.toThrow(/result file/);
        await expect(saveCheck("notes.md", "F-004", { agree: true, note: "" })).rejects.toThrow(/not an eval result/);
        await expect(saveCheck("a.md", "F-1; rm", { agree: true, note: "" })).rejects.toThrow(/finding label/);
        await expect(saveCheck("a.md", "F-009", { agree: true, note: "" })).rejects.toThrow(/F-009 has no judge verdict to check/);
        await expect(saveCheck("a.md", "F-123", { agree: true, note: "" })).rejects.toThrow(/F-123 has no judge verdict to check/);
    });

    it("counts a check only while the verdict it was given to is the one in the result", async () => {
        const dir = await folder({ "a.md": judged([F004]) });
        await saveCheck("a.md", "F-004", { agree: true, note: "" });
        // The result was replaced by a run whose F-004 is another finding.
        await writeFile(join(dir, "a.md"), judged([F004.replace("Raw SQL", "Open redirect")]));
        expect((await loadEvalRows()).rows[0]).toMatchObject({ judged: 1, checked: 0, agreed: 0 });
    });

    it("names a review file it cannot read instead of failing the page or overwriting it", async () => {
        const dir = await folder({ "a.md": judged([F004]), "b.md": judged([F007]) });
        await writeFile(join(dir, "a.review.json"), "<<<<<<< HEAD\n{}\n");
        await writeFile(join(dir, "b.review.json"), "null");
        const { rows, brokenReviews } = await loadEvalRows();
        expect(rows).toHaveLength(2);
        expect(brokenReviews).toEqual(["a.review.json", "b.review.json"]);
        await expect(saveCheck("a.md", "F-004", { agree: true, note: "" })).rejects.toThrow(/a\.review\.json cannot be read/);
    });

    it("keeps both of two checks saved at once", async () => {
        await folder({ "a.md": judged([F004, F007]) });
        await Promise.all([saveCheck("a.md", "F-004", { agree: true, note: "" }), saveCheck("a.md", "F-007", { agree: false, note: "" })]);
        expect(Object.keys(await loadChecks("a.md")).sort()).toEqual(["F-004", "F-007"]);
    });

    it("says how many of the judge's verdicts no line could be read for", async () => {
        await folder({ "a.md": judged([F004], 3) });
        expect((await loadEvalRows()).rows[0]).toMatchObject({ judged: 1, unreadable: 2 });
    });
});

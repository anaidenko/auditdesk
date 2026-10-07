import { execFileSync as run } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { ASPECTS } from "@/engine/aspects";
import { loadChecklist } from "@/engine/checklists";
import { SEVERITIES } from "@/engine/types";

import { type KeyEntry, type KeyLocation, loadFixtures, loadKey } from "./fixtures";

const own = loadFixtures().find(f => f.name === "own")!;

describe("the fixture list", () => {
    it("pins the own fixture by its public repository and a full commit", () => {
        expect(own.url).toBe("https://github.com/anaidenko/auditdesk-fixture");
        expect(own.sha).toMatch(/^[0-9a-f]{40}$/);
    });
});

// A full clone, not a partial one: the tests read every file, and a partial clone would fetch each blob apart.
describe("the own fixture's answer key", () => {
    const key = loadKey("own");
    let clone = "";
    beforeAll(() => {
        clone = join(mkdtempSync(join(tmpdir(), "own-fixture-")), "clone");
        run("git", ["clone", "--quiet", "--no-checkout", own.url, clone], { stdio: "pipe" });
    }, 60_000);
    // Read without trimming, or a file's leading blank lines would shift every anchor in it.
    const show = (file: string) => run("git", ["show", `${own.sha}:${file}`], { cwd: clone, encoding: "utf8" });
    const tree = () => run("git", ["ls-tree", "-r", "--name-only", own.sha], { cwd: clone, encoding: "utf8" }).split("\n").filter(Boolean);
    const located = (e: KeyEntry): KeyLocation[] => [
        ...(e.kind === "finding" ? [{ file: e.file!, startLine: e.startLine!, endLine: e.endLine!, anchor: e.anchor! }] : []),
        ...(e.also ?? [])
    ];

    it("points every location at lines that exist at the pinned commit and hold its anchor", () => {
        for (const e of key.entries) {
            if (e.kind === "finding") expect([e.file, e.startLine, e.endLine, e.anchor].every(Boolean), e.id).toBe(true);
            for (const l of located(e)) {
                const lines = show(l.file).split("\n");
                expect(l.endLine, e.id).toBeLessThanOrEqual(lines.length);
                expect(l.startLine, e.id).toBeLessThanOrEqual(l.endLine);
                expect(lines[l.startLine - 1], `${e.id} ${l.file}`).toContain(l.anchor);
            }
        }
    });

    it("plants defects for every aspect of one repository, each under an item of its aspect's checklist", async () => {
        // The own fixture is one repository, so the seams between repositories have nothing to find in it.
        expect(new Set(key.entries.map(e => e.aspect))).toEqual(new Set(ASPECTS.map(a => a.key).filter(k => k !== "seams")));
        const all = new Set((await Promise.all(ASPECTS.map(a => loadChecklist(a.key)))).flatMap(c => c.items.map(i => i.id)));
        for (const e of key.entries) {
            expect(
                (await loadChecklist(e.aspect)).items.map(i => i.id),
                e.id
            ).toContain(e.checklistItem);
            for (const item of e.alsoItems ?? []) expect(all, `${e.id} ${item}`).toContain(item);
        }
        for (const k of key.known) {
            expect(all, k.title).toContain(k.checklistItem);
            if (k.file) expect(tree(), k.title).toContain(k.file);
        }
    });

    it("keeps IDs unique, severities valid, and questions without a severity", () => {
        expect(new Set(key.entries.map(e => e.id)).size).toBe(key.entries.length);
        for (const e of key.entries) {
            expect(e.severity === null, e.id).toBe(e.kind === "question");
            if (e.severity !== null) expect(SEVERITIES, e.id).toContain(e.severity);
        }
    });

    it("names no defect anywhere in the fixture: its files, their names or its history", () => {
        const files = tree();
        expect(files.filter(f => /^\.(claude|cursor|windsurf|kiro|bolt)\//.test(f))).toEqual([]);
        const log = run("git", ["log", "--format=%B", own.sha], { cwd: clone, encoding: "utf8" });
        const text = [log, ...files.map(f => `${f}\n${show(f)}`)].join("\n").toLowerCase();
        for (const word of ["vuln", "insecure", "planted", "exploit", "xss", "ssrf", "idor", "injection", "todo", "fixme", "unsafe"]) {
            expect(text, word).not.toContain(word);
        }
        for (const e of key.entries) expect(text, e.id).not.toContain(e.title.toLowerCase());
    });
});

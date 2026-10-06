import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ASPECTS } from "@/engine/aspects";
import { loadChecklist } from "@/engine/checklists";
import { git } from "@/engine/git";

import { fixturePath, loadFixtures, loadKey } from "./fixtures";

const own = loadFixtures().find(f => f.name === "own")!;
const present = existsSync(fixturePath(own));

describe("the fixture list", () => {
    it("pins the own fixture by a relative path and a full commit", () => {
        expect(own.path).toMatch(/^\.\.\//);
        expect(own.sha).toMatch(/^[0-9a-f]{40}$/);
    });
});

// The fixture is a sibling repository until it is published (plan, Task 6.5).
describe.skipIf(!present)("the own fixture's answer key", () => {
    const key = loadKey("own");
    const show = (file: string) => git(["show", `${own.sha}:${file}`], fixturePath(own));

    it("points every located entry at lines that exist at the pinned commit and hold its anchor", async () => {
        for (const e of key.entries.filter(e => e.kind === "finding")) {
            const lines = (await show(e.file!)).split("\n");
            expect(e.endLine!, e.id).toBeLessThanOrEqual(lines.length);
            expect(e.startLine!, e.id).toBeLessThanOrEqual(e.endLine!);
            expect(lines[e.startLine! - 1], e.id).toContain(e.anchor);
        }
    });

    it("plants defects for every v1 aspect, each under an item of its aspect's checklist", async () => {
        expect(new Set(key.entries.map(e => e.aspect))).toEqual(new Set(ASPECTS.map(a => a.key)));
        for (const e of key.entries) {
            const items = (await loadChecklist(e.aspect)).items.map(i => i.id);
            expect(items, e.id).toContain(e.checklistItem);
        }
    });

    it("keeps IDs unique and questions without a severity", () => {
        expect(new Set(key.entries.map(e => e.id)).size).toBe(key.entries.length);
        for (const e of key.entries) expect(e.severity === null, e.id).toBe(e.kind === "question");
    });

    it("names no defect anywhere in the fixture", async () => {
        const files = (await git(["ls-tree", "-r", "--name-only", own.sha], fixturePath(own))).split("\n").filter(Boolean);
        const tree = (await Promise.all(files.map(async f => `${f}\n${await show(f)}`))).join("\n").toLowerCase();
        for (const word of ["vuln", "insecure", "planted", "exploit", "xss", "ssrf", "idor", "injection", "todo", "fixme", "unsafe"]) {
            expect(tree, word).not.toContain(word);
        }
        for (const e of key.entries) expect(tree, e.id).not.toContain(e.title.toLowerCase());
    });
});

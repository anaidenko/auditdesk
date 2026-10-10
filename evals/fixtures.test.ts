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

describe("the own fixture's answer key", () => {
    const key = loadKey("own");

    it("files every entry under an item of its aspect's checklist, and plants defects for every aspect of one web repository", async () => {
        // The own fixture is one repository and no mobile app: the seams between repositories and the
        // mobile aspect have nothing to find in it. A new aspect joins its list, and its key, by hand.
        const web = ASPECTS.map(a => a.key).filter(k => k !== "seams" && k !== "mobile");
        expect(own.aspects).toEqual(web);
        expect(new Set(key.entries.map(e => e.aspect))).toEqual(new Set(web));
        const all = new Set((await Promise.all(ASPECTS.map(a => loadChecklist(a.key)))).flatMap(c => c.items.map(i => i.id)));
        for (const e of key.entries) {
            expect(
                (await loadChecklist(e.aspect)).items.map(i => i.id),
                e.id
            ).toContain(e.checklistItem);
            for (const item of e.alsoItems ?? []) expect(all, `${e.id} ${item}`).toContain(item);
        }
        for (const k of key.known) expect(all, k.title).toContain(k.checklistItem);
    });

    it("keeps IDs unique, severities valid, and questions without a severity", () => {
        expect(new Set(key.entries.map(e => e.id)).size).toBe(key.entries.length);
        for (const e of key.entries) {
            expect(e.severity === null, e.id).toBe(e.kind === "question");
            if (e.severity !== null) expect(SEVERITIES, e.id).toContain(e.severity);
        }
    });
});

// A full clone, not a partial one: the tests read every file, and a partial clone would fetch each blob apart.
function atPinnedCommit(name: string, o: { audited: (file: string) => boolean }) {
    const spec = loadFixtures().find(f => f.name === name)!;
    const key = loadKey(name);
    let clone = "";
    beforeAll(() => {
        clone = join(mkdtempSync(join(tmpdir(), `${name}-fixture-`)), "clone");
        try {
            // execFileSync blocks vitest's hook timeout, so the clone carries its own, and a missing
            // repository fails rather than waiting at a password prompt or an askpass dialog.
            run("git", ["clone", "--quiet", "--no-checkout", spec.url, clone], {
                stdio: "pipe",
                timeout: 60_000,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" }
            });
        } catch (e) {
            throw new Error(
                `Cannot clone ${spec.url}. Offline, point it at a local clone: GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.<path>.insteadOf GIT_CONFIG_VALUE_0=${spec.url} pnpm test`,
                { cause: e }
            );
        }
    }, 70_000);
    // Read without trimming, or a file's leading blank lines would shift every anchor in it.
    const show = (file: string) => run("git", ["show", `${spec.sha}:${file}`], { cwd: clone, encoding: "utf8" });
    const tree = () => run("git", ["ls-tree", "-r", "--name-only", spec.sha], { cwd: clone, encoding: "utf8" }).split("\n").filter(Boolean);
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

    it("names only files the fixture has as the places of its known issues", () => {
        for (const k of key.known) if (k.file) expect(tree(), k.title).toContain(k.file);
    });

    it("names no defect anywhere the agents read: the audited files, their names or the history", () => {
        const files = tree().filter(o.audited);
        expect(files.filter(f => /(^|\/)\.(claude|cursor|windsurf|kiro|bolt)\//.test(f))).toEqual([]);
        const log = run("git", ["log", "--format=%B", spec.sha], { cwd: clone, encoding: "utf8" });
        const text = [log, ...files.map(f => `${f}\n${show(f)}`)].join("\n").toLowerCase();
        for (const word of [
            "vuln",
            "insecure",
            "planted",
            "exploit",
            "xss",
            "ssrf",
            "idor",
            "injection",
            "todo",
            "fixme",
            "unsafe",
            "a11y",
            "wcag",
            "idempot",
            "prefetch",
            "contrast",
            "masvs",
            "leak",
            "hardcod",
            "bypass",
            "attacker",
            "malicious"
        ]) {
            expect(text, word).not.toContain(word);
        }
        for (const e of key.entries) expect(text, e.id).not.toContain(e.title.toLowerCase());
    });
}

describe("the own fixture at its pinned commit", () => atPinnedCommit("own", { audited: () => true }));

describe("the mobile fixture's answer key", () => {
    const spec = loadFixtures().find(f => f.name === "mobile")!;
    const key = loadKey("mobile");

    it("pins two apps by their public repository and a full commit, each audited as a repository of its own", () => {
        expect(spec.url).toBe("https://github.com/anaidenko/auditdesk-mobile-fixture");
        expect(spec.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(spec.dirs).toEqual(["expo-app", "capacitor-app"]);
        expect(spec.aspects).toEqual(["security", "mobile"]);
    });

    it("files every entry under an item of the run's checklists, at a path inside one of the apps", async () => {
        const items = new Set((await Promise.all(ASPECTS.map(a => loadChecklist(a.key)))).flatMap(c => c.items.map(i => i.id)));
        for (const e of key.entries) {
            expect(spec.aspects, e.id).toContain(e.aspect);
            expect(
                (await loadChecklist(e.aspect)).items.map(i => i.id),
                e.id
            ).toContain(e.checklistItem);
            for (const item of e.alsoItems ?? []) expect(items, `${e.id} ${item}`).toContain(item);
            for (const file of [e.file, ...(e.also ?? []).map(l => l.file)].filter(Boolean))
                expect(
                    spec.dirs!.some(d => file!.startsWith(`${d}/`)),
                    `${e.id} ${file}`
                ).toBe(true);
        }
        for (const k of key.known) expect(items, k.title).toContain(k.checklistItem);
    });

    it("plants 8 to 10 defects in each app, keeps IDs unique and gives each a severity", () => {
        for (const d of spec.dirs!) {
            const n = key.entries.filter(e => e.file?.startsWith(`${d}/`)).length;
            expect(n, d).toBeGreaterThanOrEqual(8);
            expect(n, d).toBeLessThanOrEqual(10);
        }
        expect(new Set(key.entries.map(e => e.id)).size).toBe(key.entries.length);
        for (const e of key.entries) expect(SEVERITIES, e.id).toContain(e.severity);
    });
});

// The repository's own README warns that it is deliberately vulnerable: no audit reads it, since
// each app is audited from its own folder.
describe("the mobile fixture at its pinned commit", () =>
    atPinnedCommit("mobile", { audited: f => ["expo-app/", "capacitor-app/"].some(d => f.startsWith(d)) }));

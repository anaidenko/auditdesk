import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse } from "yaml";

import type { SeverityName } from "@/engine/types";

export interface FixtureSpec {
    name: string;
    /** A path relative to this repository, until the fixture is published; then `url`. */
    path?: string;
    url?: string;
    sha: string;
}

export interface KeyEntry {
    id: string;
    aspect: string;
    checklistItem: string;
    /** "absence": nothing to point at, matched by checklist item; "question": never a false finding. */
    kind: "finding" | "absence" | "question";
    severity: SeverityName | null;
    title: string;
    file?: string;
    startLine?: number;
    endLine?: number;
    /** Text the entry's first line holds, so a shifted fixture fails its test. */
    anchor?: string;
}

export interface AnswerKey {
    fixture: string;
    entries: KeyEntry[];
    /** True issues of the fixture that were not planted; a finding that names one is not false. */
    known: { checklistItem: string; title: string; file?: string }[];
}

const root = resolve(import.meta.dirname, "..");

export function loadFixtures(): FixtureSpec[] {
    return (parse(readFileSync(resolve(root, "evals/fixtures.yaml"), "utf8")) as { fixtures: FixtureSpec[] }).fixtures;
}

export function fixturePath(f: FixtureSpec): string {
    if (!f.path || isAbsolute(f.path)) throw new Error(`Fixture ${f.name} needs a path relative to the repository`);
    return resolve(root, f.path);
}

export function loadKey(fixture: string): AnswerKey {
    return parse(readFileSync(resolve(root, `evals/answers/${fixture}-fixture.yaml`), "utf8")) as AnswerKey;
}

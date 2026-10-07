import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ASPECTS } from "./aspects";

export const ASPECT_PREFIX: Record<string, string> = Object.fromEntries(ASPECTS.map(a => [a.key, a.prefix]));

export interface Checklist {
    aspect: string;
    title: string;
    items: { id: string; title: string; aiBuilt: boolean }[];
    text: string;
}

const AI_BUILT = /\(AI-built\)\s*$/;

export function parseChecklist(aspect: string, md: string): Checklist {
    const prefix = ASPECT_PREFIX[aspect];
    if (!prefix) throw new Error(`Unknown aspect: ${aspect}`);
    const title = md.match(/^# (.+)$/m)?.[1] ?? aspect;
    const items: Checklist["items"] = [];
    for (const m of md.matchAll(/^## ([A-Z]{3}-\d{2}) (.+)$/gm)) {
        if (!m[1].startsWith(`${prefix}-`)) throw new Error(`${m[1]} does not belong to the ${aspect} checklist`);
        if (items.some(i => i.id === m[1])) throw new Error(`Duplicate checklist item ${m[1]}`);
        items.push({ id: m[1], title: m[2].trim(), aiBuilt: AI_BUILT.test(m[2]) });
    }
    return { aspect, title, items, text: md.trim() };
}

export async function loadChecklist(aspect: string, dir = "checklists"): Promise<Checklist> {
    return parseChecklist(aspect, await readFile(join(dir, `${aspect}.md`), "utf8"));
}

/**
 * The checklist an agent gets: the items marked "(AI-built)" only in the AI-built mode (design § 7).
 * They sit after the cache breakpoint, so the mode never changes the shared prefix.
 */
export function forMode(c: Checklist, aiBuilt: boolean): Checklist {
    if (aiBuilt || !c.items.some(i => i.aiBuilt)) return c;
    // Cut from each item's own heading to the next one, never at a "## " line inside fenced code.
    const kept: string[] = [];
    let fenced = false;
    let dropping = false;
    for (const line of c.text.split("\n")) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        if (!fenced && /^## [A-Z]{3}-\d{2} /.test(line)) dropping = AI_BUILT.test(line);
        if (!dropping) kept.push(line);
    }
    return { ...c, items: c.items.filter(i => !i.aiBuilt), text: kept.join("\n").trim() };
}

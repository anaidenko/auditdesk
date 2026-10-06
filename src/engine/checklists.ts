import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const ASPECT_PREFIX: Record<string, string> = {
    security: "SEC",
    dependencies: "DEP",
    architecture: "ARC",
    data: "DAT",
    quality: "QUA",
    production: "PRD",
    llm: "LLM",
    tenancy: "TEN"
};

export interface Checklist {
    aspect: string;
    title: string;
    items: { id: string; title: string }[];
    text: string;
}

export function parseChecklist(aspect: string, md: string): Checklist {
    const prefix = ASPECT_PREFIX[aspect];
    if (!prefix) throw new Error(`Unknown aspect: ${aspect}`);
    const title = md.match(/^# (.+)$/m)?.[1] ?? aspect;
    const items: { id: string; title: string }[] = [];
    for (const m of md.matchAll(/^## ([A-Z]{3}-\d{2}) (.+)$/gm)) {
        if (!m[1].startsWith(`${prefix}-`)) throw new Error(`${m[1]} does not belong to the ${aspect} checklist`);
        if (items.some(i => i.id === m[1])) throw new Error(`Duplicate checklist item ${m[1]}`);
        items.push({ id: m[1], title: m[2].trim() });
    }
    return { aspect, title, items, text: md.trim() };
}

export async function loadChecklist(aspect: string, dir = "checklists"): Promise<Checklist> {
    return parseChecklist(aspect, await readFile(join(dir, `${aspect}.md`), "utf8"));
}

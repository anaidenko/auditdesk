/**
 * The v1 aspect catalogue (design § 7), in the order agents run and the report lists them.
 * Each has a checklist in `checklists/<key>.md` whose title is `title`.
 */
export const ASPECTS = [
    { key: "security", prefix: "SEC", title: "Security", conditional: false },
    { key: "dependencies", prefix: "DEP", title: "Dependencies and supply chain", conditional: false },
    { key: "architecture", prefix: "ARC", title: "Architecture and structure", conditional: false },
    { key: "data", prefix: "DAT", title: "Data model and database", conditional: false },
    { key: "quality", prefix: "QUA", title: "Code quality and tests", conditional: false },
    { key: "production", prefix: "PRD", title: "Production readiness", conditional: false },
    { key: "llm", prefix: "LLM", title: "LLM integrations", conditional: true, when: "the code calls a language model" },
    { key: "tenancy", prefix: "TEN", title: "Multi-tenancy", conditional: true, when: "records belong to tenants" }
] as const;

export type AspectKey = (typeof ASPECTS)[number]["key"];

export function aspectTitle(key: string): string {
    return ASPECTS.find(a => a.key === key)?.title ?? key;
}

/** The aspects a run starts: security always, then the chosen ones in the catalogue's order. */
export function selectAspects(keys: string[]): { ok: true; value: AspectKey[] } | { ok: false; error: string } {
    const unknown = keys.find(k => !ASPECTS.some(a => a.key === k));
    if (unknown !== undefined) return { ok: false, error: `Unknown aspect: ${unknown}.` };
    return { ok: true, value: ASPECTS.filter(a => a.key === "security" || keys.includes(a.key)).map(a => a.key) };
}

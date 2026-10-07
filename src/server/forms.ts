import { DEFAULT_EFFORT, DEFAULT_MODEL, type Effort } from "@/engine/agent/request";
import { type AspectKey, agentCount, selectAspects } from "@/engine/aspects";
import { validateBudget } from "@/engine/budget";
import { EFFORTS, MODEL_CHOICES } from "@/engine/models";
import type { Brief } from "@/engine/prompts";
import type { ModelAccess } from "@/engine/types";
import { parseSource } from "@/engine/workspace";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseProjectForm(fd: FormData): Parsed<{ name: string }> {
    const name = String(fd.get("name") ?? "").trim();
    return name ? { ok: true, value: { name } } : { ok: false, error: "Name the project." };
}

export function parseRepositoryForm(fd: FormData): Parsed<{ source: string; branch: string }> {
    const source = String(fd.get("source") ?? "").trim();
    const branch = String(fd.get("branch") ?? "").trim() || "main";
    try {
        parseSource(source);
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
    return { ok: true, value: { source, branch } };
}

export function parseRunForm(
    fd: FormData,
    repositories: number
): Parsed<{ budgetUsd: number; budgetTokens: number; aspects: AspectKey[]; model: string; effort: Effort }> {
    const aspects = selectAspects(fd.getAll("aspects").map(String));
    if (!aspects.ok) return aspects;
    const model = String(fd.get("model") || DEFAULT_MODEL);
    if (!MODEL_CHOICES.some(m => m.id === model)) return { ok: false, error: "Choose one of the offered models." };
    const effort = String(fd.get("effort") || DEFAULT_EFFORT) as Effort;
    if (!EFFORTS.includes(effort)) return { ok: false, error: "Choose one of the offered efforts." };
    const budgetUsd = Number(fd.get("budgetUsd"));
    const budgetTokens = Math.round(Number(fd.get("budgetKTokens")) * 1000);
    const error = validateBudget({ usd: budgetUsd, tokens: budgetTokens }, agentCount(repositories, aspects.value));
    return error ? { ok: false, error } : { ok: true, value: { budgetUsd, budgetTokens, aspects: aspects.value, model, effort } };
}

export function parseModelAccess(fd: FormData): Parsed<ModelAccess> {
    const v = String(fd.get("modelAccess") ?? "");
    return v === "claude_plan" || v === "api_key" ? { ok: true, value: v } : { ok: false, error: "Choose Claude plan or API key." };
}

const MAX_NOTE = 4000;
const note = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim() || null;
const tooLong = (...v: (string | null)[]) => v.some(x => (x?.length ?? 0) > MAX_NOTE);
const TOO_LONG = "Keep each field under 4,000 characters.";

/** The brief goes into every agent's prompt, so each field is capped. */
export function parseBriefForm(fd: FormData): Parsed<Brief> {
    const value = {
        product: note(fd, "product"),
        concerns: note(fd, "concerns"),
        outOfScope: note(fd, "outOfScope"),
        aiBuilt: fd.get("aiBuilt") === "on"
    };
    return tooLong(value.product, value.concerns, value.outOfScope) ? { ok: false, error: TOO_LONG } : { ok: true, value };
}

/** `confirm`: the "Save and confirm" button; the other saves the instructions alone. */
export function parseRepositoryNotesForm(
    fd: FormData
): Parsed<{ stackText: string | null; instructions: string | null; confirm: boolean }> {
    const value = { stackText: note(fd, "stackText"), instructions: note(fd, "instructions"), confirm: fd.get("intent") === "confirm" };
    return tooLong(value.stackText, value.instructions) ? { ok: false, error: TOO_LONG } : { ok: true, value };
}

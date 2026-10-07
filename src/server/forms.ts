import { type AspectKey, selectAspects } from "@/engine/aspects";
import { validateBudget } from "@/engine/budget";
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
): Parsed<{ budgetUsd: number; budgetTokens: number; aspects: AspectKey[] }> {
    const aspects = selectAspects(fd.getAll("aspects").map(String));
    if (!aspects.ok) return aspects;
    const budgetUsd = Number(fd.get("budgetUsd"));
    const budgetTokens = Math.round(Number(fd.get("budgetKTokens")) * 1000);
    const error = validateBudget({ usd: budgetUsd, tokens: budgetTokens }, repositories * aspects.value.length);
    return error ? { ok: false, error } : { ok: true, value: { budgetUsd, budgetTokens, aspects: aspects.value } };
}

export function parseModelAccess(fd: FormData): Parsed<ModelAccess> {
    const v = String(fd.get("modelAccess") ?? "");
    return v === "claude_plan" || v === "api_key" ? { ok: true, value: v } : { ok: false, error: "Choose Claude plan or API key." };
}

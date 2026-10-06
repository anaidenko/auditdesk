import { validateBudget } from "@/engine/budget";
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

export function parseRunForm(fd: FormData, agents: number): Parsed<{ budgetUsd: number; budgetTokens: number }> {
    const budgetUsd = Number(fd.get("budgetUsd"));
    const budgetTokens = Math.floor(Number(fd.get("budgetTokens")));
    const error = validateBudget({ usd: budgetUsd, tokens: budgetTokens }, agents);
    return error ? { ok: false, error } : { ok: true, value: { budgetUsd, budgetTokens } };
}

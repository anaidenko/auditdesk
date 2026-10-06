import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

import type { Ruleset } from "./types";

export const RULESETS = ["javascript", "typescript", "react"];

/**
 * Semgrep's registry rules change upstream and may not be redistributed (Semgrep Rules License
 * v1.0), so each run downloads them into its own folder and records their hash (design § 5, § 15).
 */
export async function fetchRulesets(names: string[], dir: string, fetchImpl: typeof fetch = fetch): Promise<Ruleset[]> {
    await mkdir(dir, { recursive: true });
    const out: Ruleset[] = [];
    for (const name of names) {
        const res = await fetchImpl(`https://semgrep.dev/c/p/${name}`, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`Semgrep ruleset p/${name}: HTTP ${res.status}`);
        const text = await res.text();
        const rules = (parse(text)?.rules ?? []).length;
        if (!rules) throw new Error(`Semgrep ruleset p/${name} has no rules`);
        const file = join(dir, `${name}.yml`);
        await writeFile(file, text);
        out.push({ name, file, sha256: createHash("sha256").update(text).digest("hex"), rules });
    }
    return out;
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Masker } from "./masker";
import { walk } from "./paths";

const ROUTE = /\b(?:app|router|server)\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/g;
const ENV = /\b(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g;
const TEST = /(^|\/)(__tests__|tests?|e2e|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const CODE = /\.[cm]?[jt]sx?$/;

export async function buildRepoMap(root: string, masker: Masker, o: { maxChars?: number } = {}): Promise<string> {
    const maxChars = o.maxChars ?? 40_000;
    const files: { rel: string; size: number }[] = [];
    for await (const e of walk(root)) if (!("symlink" in e)) files.push(e);
    const read = (rel: string) => readFile(join(root, rel), "utf8").catch(() => "");

    const entry: string[] = [];
    const routes: string[] = [];
    const env = new Set<string>();
    const data: string[] = [];
    const tests: string[] = [];

    for (const f of files.filter(f => f.rel.endsWith("package.json"))) {
        let pkg: { main?: string; scripts?: Record<string, string> };
        try {
            pkg = JSON.parse((await read(f.rel)).replace(/^\uFEFF/, "") || "{}");
        } catch {
            // Templates and broken files are the client's to fix, not a reason to stop the audit.
            entry.push(`${f.rel}: not valid JSON`);
            continue;
        }
        if (pkg.main) entry.push(`${f.rel} main: ${pkg.main}`);
        for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) entry.push(`${f.rel} script ${name}: ${cmd}`);
    }
    for (const f of files) {
        const next = f.rel.match(/^(?:src\/)?app\/(.*?)\/?(page|route)\.[jt]sx?$/);
        if (next) routes.push(`${next[2]} /${next[1].replace(/\([^)]*\)\/?/g, "")} (${f.rel})`);
        if (TEST.test(f.rel) || f.rel.startsWith(".github/workflows/")) tests.push(f.rel);
        if (/(^|\/)migrations?\//.test(f.rel)) data.push(`migration ${f.rel}`);
        if (f.rel.endsWith("schema.prisma")) {
            const models = [...(await read(f.rel)).matchAll(/^model (\w+)/gm)].map(m => m[1]);
            data.push(`${f.rel}: Prisma models: ${models.join(", ")}`);
        }
        if (/(^|\/)\.env[\w.-]*$/.test(f.rel))
            for (const m of (await read(f.rel)).matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)) env.add(`${m[1]} (${f.rel})`);
        if (CODE.test(f.rel) && f.size < 1_000_000) {
            const lines = (await read(f.rel)).split("\n");
            lines.forEach((line, i) => {
                for (const m of line.matchAll(ROUTE)) routes.push(`${m[1].toUpperCase()} ${m[2]} (${f.rel}:${i + 1})`);
                for (const m of line.matchAll(ENV)) env.add(m[1]);
            });
        }
    }

    const dirs = new Map<string, { files: number; bytes: number }>();
    for (const f of files) {
        const dir = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : ".";
        const d = dirs.get(dir) ?? { files: 0, bytes: 0 };
        dirs.set(dir, { files: d.files + 1, bytes: d.bytes + f.size });
    }

    const section = (title: string, rows: string[]) => `## ${title}\n${rows.length ? rows.join("\n") : "(none found)"}`;
    const text = [
        `# Repository map (${files.length} files)`,
        section("Entry points and scripts", entry),
        section("Routes and handlers", routes),
        section("Data schema and migrations", data),
        section("Environment variables used", [...env].sort()),
        section("Tests and CI", tests),
        section(
            "Directories (files, bytes)",
            [...dirs].sort(([a], [b]) => a.localeCompare(b)).map(([d, s]) => `${d}/ (${s.files}, ${s.bytes})`)
        )
    ].join("\n\n");
    const masked = masker.mask(text);
    if (masked.length <= maxChars) return masked;
    const note = `\n… map cut at ${maxChars} characters; use list_files for the rest.`;
    return masked.slice(0, maxChars - note.length) + note;
}

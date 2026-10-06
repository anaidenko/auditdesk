import { readFile } from "node:fs/promises";

import type { AspectKey } from "./aspects";
import { git } from "./git";
import { resolveInClone } from "./paths";

/** What stack detection found in a clone, from manifests and schemas read as text (design § 6). */
export interface StackProfile {
    languages: string[];
    frameworks: string[];
    databases: string[];
    orms: string[];
    auth: string[];
    llmSdks: string[];
    tenancyHints: string[];
    aiBuiltSigns: string[];
    notCovered: string[];
    /** Every file detection read, and nothing else. */
    manifests: string[];
}

export const EMPTY_STACK: StackProfile = {
    languages: [],
    frameworks: [],
    databases: [],
    orms: [],
    auth: [],
    llmSdks: [],
    tenancyHints: [],
    aiBuiltSigns: [],
    notCovered: [],
    manifests: []
};

type Reader = (rel: string) => Promise<string>;

const MAX_SQL_FILES = 40;
const MAX_FILE_CHARS = 1_000_000;

const LANGUAGES: { ext: RegExp; name: string; covered: boolean; manifests?: RegExp }[] = [
    { ext: /\.(ts|tsx|mts|cts)$/, name: "TypeScript", covered: true },
    { ext: /\.(js|jsx|mjs|cjs)$/, name: "JavaScript", covered: true },
    { ext: /\.py$/, name: "Python", covered: false, manifests: /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py)$/ },
    { ext: /\.go$/, name: "Go", covered: false, manifests: /(^|\/)go\.mod$/ },
    { ext: /\.java$/, name: "Java", covered: false, manifests: /(^|\/)(pom\.xml|build\.gradle)$/ },
    { ext: /\.kts?$/, name: "Kotlin", covered: false, manifests: /(^|\/)build\.gradle\.kts$/ },
    { ext: /\.rb$/, name: "Ruby", covered: false, manifests: /(^|\/)Gemfile$/ },
    { ext: /\.php$/, name: "PHP", covered: false, manifests: /(^|\/)composer\.json$/ },
    { ext: /\.cs$/, name: "C#", covered: false, manifests: /\.(csproj|sln)$/ },
    { ext: /\.rs$/, name: "Rust", covered: false, manifests: /(^|\/)Cargo\.toml$/ },
    { ext: /\.swift$/, name: "Swift", covered: false, manifests: /(^|\/)Package\.swift$/ },
    { ext: /\.dart$/, name: "Dart", covered: false, manifests: /(^|\/)pubspec\.yaml$/ },
    { ext: /\.(c|cc|cpp|h|hpp)$/, name: "C/C++", covered: false }
];

/** Package name (or a prefix ending in "/") to a label; "{v}" takes the major version. */
type Table = [string, string][];

const FRAMEWORKS: Table = [
    ["next", "Next.js {v}"],
    ["react", "React {v}"],
    ["@angular/core", "Angular {v}"],
    ["@ionic/angular", "Ionic {v} (Angular)"],
    ["@ionic/react", "Ionic {v} (React)"],
    ["@ionic/vue", "Ionic {v} (Vue)"],
    ["@capacitor/core", "Capacitor {v}"],
    ["cordova", "Cordova {v}"],
    ["vue", "Vue {v}"],
    ["nuxt", "Nuxt {v}"],
    ["svelte", "Svelte {v}"],
    ["@sveltejs/kit", "SvelteKit {v}"],
    ["express", "Express {v}"],
    ["fastify", "Fastify {v}"],
    ["@nestjs/core", "NestJS {v}"],
    ["koa", "Koa {v}"],
    ["hono", "Hono {v}"],
    ["react-native", "React Native {v}"],
    ["expo", "Expo {v}"],
    ["electron", "Electron {v}"],
    ["@remix-run/react", "Remix {v}"],
    ["astro", "Astro {v}"],
    ["@trpc/server", "tRPC {v}"],
    ["graphql", "GraphQL"]
];

const DATABASES: Table = [
    ["pg", "PostgreSQL"],
    ["postgres", "PostgreSQL"],
    ["@neondatabase/serverless", "PostgreSQL"],
    ["@vercel/postgres", "PostgreSQL"],
    ["mysql2", "MySQL"],
    ["mysql", "MySQL"],
    ["mongodb", "MongoDB"],
    ["mongoose", "MongoDB"],
    ["sqlite3", "SQLite"],
    ["better-sqlite3", "SQLite"],
    ["redis", "Redis"],
    ["ioredis", "Redis"],
    ["@supabase/supabase-js", "Supabase (PostgreSQL)"],
    ["firebase", "Firebase"],
    ["firebase-admin", "Firebase"],
    ["mssql", "SQL Server"],
    ["oracledb", "Oracle"]
];

const PRISMA_PROVIDERS: Record<string, string> = {
    postgresql: "PostgreSQL",
    postgres: "PostgreSQL",
    mysql: "MySQL",
    sqlite: "SQLite",
    mongodb: "MongoDB",
    sqlserver: "SQL Server",
    cockroachdb: "CockroachDB"
};

const ORMS: Table = [
    ["@prisma/client", "Prisma"],
    ["prisma", "Prisma"],
    ["typeorm", "TypeORM"],
    ["sequelize", "Sequelize"],
    ["mongoose", "Mongoose"],
    ["drizzle-orm", "Drizzle"],
    ["knex", "Knex"],
    ["@mikro-orm/core", "MikroORM"],
    ["kysely", "Kysely"],
    ["objection", "Objection"]
];

const AUTH: Table = [
    ["next-auth", "Auth.js (NextAuth)"],
    ["@auth/core", "Auth.js (NextAuth)"],
    ["passport", "Passport"],
    ["jsonwebtoken", "jsonwebtoken (JWT)"],
    ["jose", "jose (JWT)"],
    ["@clerk/", "Clerk"],
    ["@auth0/", "Auth0"],
    ["lucia", "Lucia"],
    ["better-auth", "Better Auth"],
    ["@supabase/ssr", "Supabase Auth"],
    ["@supabase/auth-helpers-nextjs", "Supabase Auth"],
    ["express-session", "express-session"],
    ["bcrypt", "bcrypt"],
    ["bcryptjs", "bcrypt"],
    ["argon2", "argon2"],
    ["keycloak-js", "Keycloak"],
    ["@azure/msal-browser", "MSAL"],
    ["@azure/msal-node", "MSAL"],
    ["@okta/okta-auth-js", "Okta"]
];

const LLM_SDKS: Table = [
    ["@anthropic-ai/sdk", "Anthropic SDK"],
    ["@anthropic-ai/claude-agent-sdk", "Claude Agent SDK"],
    ["openai", "OpenAI SDK"],
    ["@google/generative-ai", "Gemini SDK"],
    ["@google/genai", "Gemini SDK"],
    ["ai", "Vercel AI SDK"],
    ["@ai-sdk/", "Vercel AI SDK"],
    ["langchain", "LangChain"],
    ["@langchain/", "LangChain"],
    ["llamaindex", "LlamaIndex"],
    ["cohere-ai", "Cohere SDK"],
    ["@mistralai/mistralai", "Mistral SDK"],
    ["ollama", "Ollama"],
    ["groq-sdk", "Groq SDK"],
    ["replicate", "Replicate"],
    ["@huggingface/inference", "Hugging Face Inference"],
    ["@aws-sdk/client-bedrock-runtime", "Amazon Bedrock"],
    ["@azure/openai", "Azure OpenAI"]
];

/** Files that agents and AI app builders leave behind; their presence suggests the AI-built mode. */
const AI_FILES =
    /^(\.cursorrules|\.windsurfrules|\.clinerules|CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.aider\.conf\.yml|\.github\/copilot-instructions\.md)$/;
const AI_FOLDERS = /^(\.cursor\/rules|\.bolt|\.kiro)\//;
const AI_PACKAGES: Table = [["lovable-tagger", "lovable-tagger (Lovable)"]];

// Tenant keys as columns or fields. `account` is left out: Auth.js schemas carry `providerAccountId`
// and per-user Account models that say nothing about tenants.
const TENANT_KEY = /\b(tenant|organi[sz]ation|org|workspace|team|company)_?id\b/gi;
const TENANT_MODEL = /^\s*model\s+(Tenant|Organi[sz]ation|Workspace|Team|Company)\b/gm;

const SQL_MIGRATION = /(^|\/)(migrations?|supabase\/migrations)\/.*\.sql$/i;

const major = (range: string) => range.match(/\d+/)?.[0];

function labels(table: Table, deps: Map<string, string>): string[] {
    const out = new Set<string>();
    for (const [name, label] of table) {
        const hits = name.endsWith("/") ? [...deps.keys()].filter(d => d.startsWith(name)) : deps.has(name) ? [name] : [];
        for (const hit of hits) {
            const v = major(deps.get(hit) ?? "");
            out.add(v ? label.replace("{v}", v) : label.replace(" {v}", ""));
        }
    }
    return [...out].sort();
}

const plural = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

/**
 * Reads the clone's tracked manifests and schemas as text, never its code: package.json files,
 * Prisma schemas and SQL migrations. Everything else is judged by file names alone.
 */
export async function detectStack(root: string, o: { read?: Reader } = {}): Promise<StackProfile> {
    const read: Reader =
        o.read ??
        (async rel => {
            const { abs } = await resolveInClone(root, rel);
            return (await readFile(abs, "utf8")).slice(0, MAX_FILE_CHARS);
        });
    const files = (await git(["ls-files", "-z"], root)).split("\0").filter(f => f && !f.includes("node_modules/"));
    const manifests: string[] = [];
    const take = async (rel: string) => {
        try {
            const text = await read(rel);
            manifests.push(rel);
            return text;
        } catch {
            return null;
        }
    };

    const deps = new Map<string, string>();
    for (const rel of files.filter(f => /(^|\/)package\.json$/.test(f))) {
        const text = await take(rel);
        try {
            const json = JSON.parse(text ?? "") as Record<string, Record<string, string> | undefined>;
            for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
                for (const [name, range] of Object.entries(json[field] ?? {})) if (!deps.has(name)) deps.set(name, String(range));
            }
        } catch {
            // A package.json that is not JSON says nothing about the stack.
        }
    }

    const databases = new Set(labels(DATABASES, deps));
    const tenancy = new Set<string>();
    const schemas = [...files.filter(f => f.endsWith(".prisma")), ...files.filter(f => SQL_MIGRATION.test(f)).slice(0, MAX_SQL_FILES)];
    for (const rel of schemas) {
        const text = await take(rel);
        if (!text) continue;
        const provider = text.match(/provider\s*=\s*"(\w+)"/g)?.map(p => p.match(/"(\w+)"/)![1]);
        for (const p of provider ?? []) if (PRISMA_PROVIDERS[p]) databases.add(PRISMA_PROVIDERS[p]);
        for (const m of text.matchAll(TENANT_KEY)) tenancy.add(`${rel}: ${m[0]}`);
        if (rel.endsWith(".prisma")) for (const m of text.matchAll(TENANT_MODEL)) tenancy.add(`${rel}: model ${m[1]}`);
    }

    const languages: string[] = [];
    const notCovered: string[] = [];
    for (const lang of LANGUAGES) {
        const sources = files.filter(f => lang.ext.test(f));
        const langManifests = lang.manifests ? files.filter(f => lang.manifests!.test(f)) : [];
        if (!sources.length && !langManifests.length) continue;
        if (lang.covered) {
            languages.push(`${lang.name} (${plural(sources.length)})`);
            continue;
        }
        const native = sources.length > 0 && sources.every(f => /^(android|ios)\//.test(f));
        const notes = [plural(sources.length), ...langManifests.slice(0, 3), ...(native ? ["the native android/ or ios/ project"] : [])];
        notCovered.push(`${lang.name} (${notes.join("; ")})`);
    }
    languages.sort((a, b) => Number(b.match(/\((\d+)/)![1]) - Number(a.match(/\((\d+)/)![1]));

    const aiBuiltSigns = [
        ...files.filter(f => AI_FILES.test(f)),
        ...new Set(files.filter(f => AI_FOLDERS.test(f)).map(f => f.match(AI_FOLDERS)![1]))
    ];
    aiBuiltSigns.push(...labels(AI_PACKAGES, deps));

    return {
        languages,
        frameworks: labels(FRAMEWORKS, deps),
        databases: [...databases].sort(),
        orms: labels(ORMS, deps),
        auth: labels(AUTH, deps),
        llmSdks: labels(LLM_SDKS, deps),
        tenancyHints: [...tenancy].sort(),
        aiBuiltSigns: aiBuiltSigns.sort(),
        notCovered,
        manifests: manifests.sort()
    };
}

/** The conditional aspects the profile calls for (design § 7). */
export function suggestAspects(s: StackProfile): AspectKey[] {
    return [...(s.llmSdks.length ? (["llm"] as const) : []), ...(s.tenancyHints.length ? (["tenancy"] as const) : [])];
}

export function suggestAiBuilt(s: StackProfile): boolean {
    return s.aiBuiltSigns.length > 0;
}

/** What a project's repositories suggest together; a repository not yet detected suggests nothing. */
export function suggestionsFor(profiles: (StackProfile | null)[]): { aspects: AspectKey[]; aiBuiltSigns: string[] } {
    const known = profiles.filter((p): p is StackProfile => !!p);
    const keys = new Set(known.flatMap(suggestAspects));
    return {
        aspects: (["llm", "tenancy"] as const).filter(k => keys.has(k)),
        aiBuiltSigns: [...new Set(known.flatMap(p => p.aiBuiltSigns))].sort()
    };
}

/** The profile as the agents read it, in the cached prefix. */
export function stackProfileText(s: StackProfile): string {
    const line = (label: string, items: string[]) => `${label}: ${items.length ? items.join(", ") : "none found"}`;
    return [
        line("Languages", s.languages),
        line("Frameworks", s.frameworks),
        line("Databases", s.databases),
        line("ORM and query builders", s.orms),
        line("Authentication", s.auth),
        line("LLM SDKs", s.llmSdks),
        line("Multi-tenancy hints", s.tenancyHints),
        line("Signs of AI-assisted development", s.aiBuiltSigns),
        line("Not covered by this audit", s.notCovered),
        line("Manifests read", s.manifests)
    ].join("\n");
}

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expandHome } from "./config";
import type { ModelAccess } from "./types";

/** The variable each access reads. Set in .env.local, it wins over a saved value. */
export const CREDENTIAL_ENV = { api_key: "ANTHROPIC_API_KEY", claude_plan: "CLAUDE_CODE_OAUTH_TOKEN" } as const satisfies Record<
    ModelAccess,
    string
>;

export type CredentialStatus = { source: "env" } | { source: "saved"; last4: string } | { source: "none" };

export class CredentialError extends Error {}

type Store = Partial<Record<ModelAccess, string>>;

/** Outside the repository and the database: dumps and copies of either must not carry a key (design § 12). */
export function credentialsPath(): string {
    return join(expandHome(process.env.AUDITDESK_HOME || "~/.auditdesk"), "credentials.json");
}

// The process environment: .env.local, or a shell export, which the UI also reports as .env.local.
const fromEnv = (access: ModelAccess) => process.env[CREDENTIAL_ENV[access]]?.trim() || null;

async function readStore(): Promise<Store> {
    const path = credentialsPath();
    const info = await stat(path).catch(() => null);
    if (!info) return {};
    if (info.mode & 0o077) throw new Error(`${path} is readable by other users; run chmod 600 on it.`);
    return JSON.parse(await readFile(path, "utf8")) as Store;
}

async function writeStore(store: Store): Promise<void> {
    const path = credentialsPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 4) + "\n", { mode: 0o600 });
    await rename(tmp, path);
}

export async function resolveCredential(access: ModelAccess): Promise<string | null> {
    return fromEnv(access) ?? (await readStore())[access] ?? null;
}

export async function credentialStatus(access: ModelAccess): Promise<CredentialStatus> {
    if (fromEnv(access)) return { source: "env" };
    const saved = (await readStore())[access];
    return saved ? { source: "saved", last4: saved.slice(-4) } : { source: "none" };
}

export async function saveCredential(access: ModelAccess, value: string): Promise<void> {
    const v = value.trim();
    if (!v || /\s/.test(v)) throw new CredentialError("Paste the whole value, with no spaces or line breaks.");
    if (fromEnv(access)) throw new CredentialError(`${CREDENTIAL_ENV[access]} is set in .env.local; change it there.`);
    await writeStore({ ...(await readStore()), [access]: v });
}

export async function removeCredential(access: ModelAccess): Promise<void> {
    const store = await readStore();
    delete store[access];
    await writeStore(store);
}

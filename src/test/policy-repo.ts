import { makeRepo } from "./git-repo";

/** Text that must never reach a model: every file holding it is excluded by the repository's own rules. */
export const CANARY = "CANARY-EXCLUDED";

/**
 * Synthetic rules of each shape the design names, none a client's: a directory (`certs/**`, also at
 * depth), a bare name (`.env`), an extension (`**\/*.p12`), a negation that carves a file out, and a
 * `/`-anchored rule a negation must not reach.
 */
export const POLICY_FILES: Record<string, string> = {
    ".claude/settings.json": JSON.stringify(
        {
            permissions: {
                deny: [
                    "Read(./certs/**)",
                    "Read(.env)",
                    "Read(**/*.p12)",
                    "Read(/keys/**)",
                    "Read(!keys/public.pem)",
                    "Read(vault/**)",
                    "Read(!vault/README.md)"
                ]
            }
        },
        null,
        2
    ),
    "certs/server.key": `-----BEGIN PRIVATE KEY-----\n${CANARY}-cert\n`,
    "certs/server.crt": `${CANARY}-crt\n`,
    "packages/api/certs/dev.key": `${CANARY}-nested\n`,
    ".env": `DB_PASSWORD=${CANARY}-env\n`,
    "api/.env": `API_TOKEN=${CANARY}-api\n`,
    "store/client.p12": `${CANARY}-p12\n`,
    "keys/private.pem": `${CANARY}-private\n`,
    "keys/public.pem": `${CANARY}-public\n`,
    "vault/secret.txt": `${CANARY}-vault\n`,
    "vault/README.md": "# Vault\n",
    "src/db.js": 'db.query("SELECT * FROM u WHERE id=" + req.query.id);\n'
};

/** The files POLICY_FILES's rules exclude. */
export const EXCLUDED = [
    ".env",
    "api/.env",
    "certs/server.crt",
    "certs/server.key",
    "keys/private.pem",
    "keys/public.pem",
    "packages/api/certs/dev.key",
    "store/client.p12",
    "vault/secret.txt"
];

export function makePolicyRepo(extra: Record<string, string> = {}): Promise<string> {
    return makeRepo({ ...POLICY_FILES, ...extra });
}

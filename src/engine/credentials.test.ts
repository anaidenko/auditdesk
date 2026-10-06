import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError, credentialStatus, credentialsPath, removeCredential, resolveCredential, saveCredential } from "./credentials";

beforeEach(async () => {
    vi.stubEnv("AUDITDESK_HOME", await mkdtemp(join(tmpdir(), "auditdesk-home-")));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("credentials", () => {
    it("takes the value from .env.local first, and shows only where it is", async () => {
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "env-token-1234");
        await expect(resolveCredential("claude_plan")).resolves.toBe("env-token-1234");
        await expect(credentialStatus("claude_plan")).resolves.toEqual({ source: "env" });
    });

    it("saves a value write-only: its status shows the last four characters", async () => {
        await saveCredential("api_key", "  saved-key-abcd ");
        await expect(resolveCredential("api_key")).resolves.toBe("saved-key-abcd");
        await expect(credentialStatus("api_key")).resolves.toEqual({ source: "saved", last4: "abcd" });
        await expect(credentialStatus("claude_plan")).resolves.toEqual({ source: "none" });
    });

    it("saves with mode 0600", async () => {
        await saveCredential("claude_plan", "plan-token-wxyz");
        expect((await stat(credentialsPath())).mode & 0o777).toBe(0o600);
    });

    it("counts an empty .env.local value as not set", async () => {
        await saveCredential("api_key", "saved-key-abcd");
        vi.stubEnv("ANTHROPIC_API_KEY", "   ");
        await expect(resolveCredential("api_key")).resolves.toBe("saved-key-abcd");
    });

    it("refuses a value with spaces inside, and a save over a value set in .env.local", async () => {
        await expect(saveCredential("api_key", "two words")).rejects.toBeInstanceOf(CredentialError);
        vi.stubEnv("ANTHROPIC_API_KEY", "env-key");
        await expect(saveCredential("api_key", "other")).rejects.toThrow(/set in \.env\.local/);
    });

    it("removes one credential and keeps the other", async () => {
        await saveCredential("api_key", "saved-key-abcd");
        await saveCredential("claude_plan", "plan-token-wxyz");
        await removeCredential("api_key");
        await expect(resolveCredential("api_key")).resolves.toBeNull();
        await expect(resolveCredential("claude_plan")).resolves.toBe("plan-token-wxyz");
    });

    it("refuses a credentials file that other users can read", async () => {
        await saveCredential("api_key", "saved-key-abcd");
        await chmod(credentialsPath(), 0o644);
        await expect(resolveCredential("api_key")).rejects.toThrow(/chmod 600/);
    });

    it("reads nothing when no file exists", async () => {
        await expect(resolveCredential("api_key")).resolves.toBeNull();
        await writeFile(join(process.env.AUDITDESK_HOME!, "unrelated"), "");
        await expect(credentialStatus("api_key")).resolves.toEqual({ source: "none" });
    });

    // The review's Minor 5: thrown from a page, the guidance would be hidden behind Next's error digest.
    it("reports a credentials file other users can read as its status, for the page to show", async () => {
        await saveCredential("api_key", "saved-key-abcd");
        await chmod(credentialsPath(), 0o644);
        await expect(credentialStatus("api_key")).resolves.toEqual({ source: "error", message: expect.stringMatching(/chmod 600/) });
    });

    it("never quotes a broken credentials file in its error", async () => {
        await saveCredential("api_key", "saved-key-abcd");
        await writeFile(credentialsPath(), '{"api_key": "sk-ant-api03-secretpart', { mode: 0o600 });
        const error = (await resolveCredential("api_key").catch(e => e)) as Error;
        expect(error.message).toMatch(/not valid JSON/);
        expect(error.message).not.toContain("secretpart");
    });
});

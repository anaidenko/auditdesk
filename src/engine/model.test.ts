import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "./model";

afterEach(() => vi.unstubAllEnvs());

describe("createClient", () => {
    it("refuses to build a live client without a key", () => {
        vi.stubEnv("AUDITDESK_REPLAY_MODEL", "");
        expect(() => createClient(null)).toThrow(/No API key/);
    });

    it("builds the live client from the key it is given, never from a profile", () => {
        vi.stubEnv("AUDITDESK_REPLAY_MODEL", "");
        expect(createClient("sk-test").apiKey).toBe("sk-test");
    });
});

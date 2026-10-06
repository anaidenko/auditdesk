import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "./model";

afterEach(() => vi.unstubAllEnvs());

describe("createClient", () => {
    it("refuses to build a live client without ANTHROPIC_API_KEY", () => {
        vi.stubEnv("AUDITDESK_REPLAY_MODEL", "");
        vi.stubEnv("ANTHROPIC_API_KEY", "");
        expect(() => createClient()).toThrow(/ANTHROPIC_API_KEY/);
    });
});

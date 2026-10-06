import { describe, expect, it } from "vitest";

import { ACCESS_TOOLTIP, credentialText } from "./model-access";

describe("ACCESS_TOOLTIP", () => {
    it("is the text Andrii approved on 2026-10-06, word for word", () => {
        expect(ACCESS_TOOLTIP.join(" ")).toBe(
            "Claude plan runs on your Claude subscription through the Agent SDK. There is no per-run cost; usage counts against your plan's limits. The code falls under the Consumer Terms: it is not used for training while \"Help improve Claude\" is off, and is kept for 30 days. API key runs on the Claude API. It is billed per token and falls under the Commercial Terms: Anthropic does not train on it. Choose the API key when a client's NDA requires commercial terms, or when the client has agreed to AI review but not under your plan."
        );
    });
});

describe("credentialText", () => {
    it("shows where a credential is, never its value, and a broken file's guidance", () => {
        expect(credentialText({ source: "env" })).toBe("set in .env.local");
        expect(credentialText({ source: "saved", last4: "abcd" })).toBe("saved · …abcd");
        expect(credentialText({ source: "none" })).toBe("not set");
        expect(credentialText({ source: "error", message: "Run chmod 600 on it." })).toBe("Run chmod 600 on it.");
    });
});

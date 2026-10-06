import type { CredentialStatus } from "@/engine/credentials";
import type { ModelAccess } from "@/engine/types";

export const ACCESS_LABEL: Record<ModelAccess, string> = { claude_plan: "Claude plan", api_key: "API key" };

// Approved by Andrii on 2026-10-06, word for word.
export const ACCESS_TOOLTIP = [
    'Claude plan runs on your Claude subscription through the Agent SDK. There is no per-run cost; usage counts against your plan\'s limits. The code falls under the Consumer Terms: it is not used for training while "Help improve Claude" is off, and is kept for 30 days.',
    "API key runs on the Claude API. It is billed per token and falls under the Commercial Terms: Anthropic does not train on it.",
    "Choose the API key when a client's NDA requires commercial terms, or when the client has agreed to AI review but not under your plan."
];

export function credentialText(s: CredentialStatus): string {
    return s.source === "env" ? "set in .env.local" : s.source === "saved" ? `saved · …${s.last4}` : "not set";
}

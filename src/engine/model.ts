import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

import { replayFetch } from "./replay";

/**
 * The live client from the key the caller resolved, or, when AUDITDESK_REPLAY_MODEL names a file
 * of recorded messages, a client that replays them (design § 13).
 */
export function createClient(apiKey: string | null): Anthropic {
    const replay = process.env.AUDITDESK_REPLAY_MODEL;
    if (replay)
        return new Anthropic({ apiKey: "replay", fetch: replayFetch(JSON.parse(readFileSync(replay, "utf8"))).fetch, maxRetries: 0 });
    // Only the key passed in: without one the SDK would fall back to an `ant auth login` profile.
    if (!apiKey) throw new Error("No API key: set ANTHROPIC_API_KEY in .env.local or save one in Settings.");
    return new Anthropic({ apiKey, maxRetries: 4 });
}

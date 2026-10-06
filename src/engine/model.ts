import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

import { replayFetch } from "./replay";

/**
 * The live client, or, when AUDITDESK_REPLAY_MODEL names a JSON file of recorded messages, a
 * client that replays them: end-to-end tests run the real app with no API call (design § 13).
 */
export function createClient(): Anthropic {
    const replay = process.env.AUDITDESK_REPLAY_MODEL;
    if (replay)
        return new Anthropic({ apiKey: "replay", fetch: replayFetch(JSON.parse(readFileSync(replay, "utf8"))).fetch, maxRetries: 0 });
    // Only an explicit key: without it the SDK would fall back to an `ant auth login` profile,
    // and a live call could happen before Andrii put a key in place (plan § Global Constraints).
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in .env.local; live runs are off until it is.");
    return new Anthropic({ apiKey, maxRetries: 4 });
}

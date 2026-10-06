import type { RunSnapshot } from "@/server/queries";

type Event = RunSnapshot["events"][number];

/** A reconnected stream starts from the first event again; each is shown once. */
export function mergeEvents(shown: Event[], incoming: Event[]): Event[] {
    const seen = new Set(shown.map(e => e.id));
    return [...shown, ...incoming.filter(e => !seen.has(e.id))];
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { stopRun } from "@/app/actions";
import type { RunSnapshot } from "@/server/queries";

import { clockTime } from "./clock";
import { mergeEvents } from "./events";

export function RunProgress({ runId }: { runId: string }) {
    const [snap, setSnap] = useState<Omit<RunSnapshot, "events"> | null>(null);
    const [events, setEvents] = useState<RunSnapshot["events"]>([]);
    const router = useRouter();
    useEffect(() => {
        const source = new EventSource(`/runs/${runId}/events`);
        source.onmessage = e => {
            const next = JSON.parse(e.data) as RunSnapshot;
            setSnap(next);
            setEvents(prev => mergeEvents(prev, next.events));
            if (next.terminal) {
                source.close();
                // The page around this component (the re-run buttons) is rendered by the server.
                router.refresh();
            }
        };
        return () => source.close();
    }, [runId, router]);

    if (!snap) return <p className="text-zinc-500">Connecting…</p>;
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <span data-testid="run-status" className="rounded bg-zinc-200 px-2 py-1 text-sm">
                    {snap.stopRequested && !snap.terminal ? "stopping after the current call" : snap.status}
                </span>
                <span className="text-sm text-zinc-600">
                    ${snap.spendUsd.toFixed(2)}
                    {snap.unpriced && " + unpriced calls"} · {snap.findings} findings
                </span>
                {!snap.terminal && (
                    <form action={stopRun.bind(null, runId)}>
                        <button className="rounded border border-red-700 px-3 py-1 text-sm text-red-700">Stop</button>
                    </form>
                )}
            </div>
            <ul className="text-sm">
                {snap.agents.map(a => (
                    <li key={a.id}>
                        {a.aspect}: {a.status} {a.note && <span className="text-zinc-500">— {a.note}</span>}
                    </li>
                ))}
            </ul>
            <ol className="max-h-[28rem] overflow-y-auto rounded border border-zinc-200 bg-white p-3 font-mono text-xs">
                {events.map(e => (
                    <li key={e.id} className={e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-700" : ""}>
                        {clockTime(e.at)} {e.message}
                    </li>
                ))}
            </ol>
        </div>
    );
}

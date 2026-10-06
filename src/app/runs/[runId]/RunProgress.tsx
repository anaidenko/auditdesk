"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { stopRun } from "@/app/actions";
import { RunStatus, button, cx } from "@/app/ui";
import type { RunSnapshot } from "@/server/queries";

import { clockTime } from "./clock";
import { mergeEvents } from "./events";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</div>
            <div className="mt-2 flex min-h-8 items-center gap-3">{children}</div>
        </div>
    );
}

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

    if (!snap) return <div className="h-28 animate-pulse rounded-xl bg-zinc-200/60" aria-label="Connecting…" />;
    return (
        <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Status">
                    <RunStatus
                        testId="run-status"
                        status={snap.stopRequested && !snap.terminal ? "stopping after the current call" : snap.status}
                    />
                    {!snap.terminal && (
                        <form action={stopRun.bind(null, runId)} className="ml-auto">
                            <button className={`${button.danger} ${button.small}`}>Stop</button>
                        </form>
                    )}
                </Stat>
                <Stat label="Spend">
                    <span className="text-2xl font-semibold tracking-tight tabular-nums">${snap.spendUsd.toFixed(2)}</span>
                    {snap.unpriced && <span className="text-xs text-amber-700">+ unpriced calls</span>}
                </Stat>
                <Stat label="Findings">
                    <span className="text-2xl font-semibold tracking-tight tabular-nums">{snap.findings}</span>
                </Stat>
            </div>

            {snap.agents.length > 0 && (
                <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white shadow-sm">
                    {snap.agents.map(a => (
                        <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                            <span className="font-medium capitalize">{a.aspect}</span>
                            <RunStatus status={a.status} />
                            {a.note && <span className="text-zinc-500">{a.note}</span>}
                        </li>
                    ))}
                </ul>
            )}

            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-sm">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
                    <span aria-hidden className="size-2.5 rounded-full bg-zinc-700" />
                    <span aria-hidden className="size-2.5 rounded-full bg-zinc-700" />
                    <span aria-hidden className="size-2.5 rounded-full bg-zinc-700" />
                    <span className="ml-2 text-xs font-medium text-zinc-400">Activity log</span>
                </div>
                <ol className="max-h-[28rem] space-y-0.5 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
                    {events.map(e => (
                        <li key={e.id} className="flex gap-3">
                            <span className="shrink-0 text-zinc-500 tabular-nums">{clockTime(e.at)}</span>
                            <span
                                className={cx(
                                    e.level === "error" ? "text-red-400" : e.level === "warn" ? "text-amber-300" : "text-zinc-200"
                                )}
                            >
                                {e.message}
                            </span>
                        </li>
                    ))}
                    {!events.length && <li className="text-zinc-500">Waiting for the first event…</li>}
                </ol>
            </div>
        </div>
    );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/app/ActionForm";
import { acceptAction, excludeAction, rejectAction } from "@/app/review-actions";
import { prisma } from "@/server/db";
import { listFindings } from "@/server/review";

export const dynamic = "force-dynamic";

const STATUSES = ["unreviewed", "accepted", "edited", "rejected", "excluded", "merged", "superseded"];

export default async function FindingsPage({
    params,
    searchParams
}: {
    params: Promise<{ projectId: string }>;
    searchParams: Promise<{ q?: string; status?: string }>;
}) {
    const { projectId } = await params;
    const { q, status } = await searchParams;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) notFound();
    const findings = await listFindings(projectId, { q: q || undefined, status: status || undefined });
    const counts = await prisma.finding.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } });

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">
                Findings · <Link href={`/projects/${projectId}`}>{project.name}</Link>
            </h1>
            <p className="text-sm text-zinc-600">{counts.map(c => `${c.status} ${c._count._all}`).join(" · ")}</p>
            <form className="flex gap-3">
                <input
                    name="q"
                    defaultValue={q}
                    placeholder="Search titles, explanations, evidence"
                    className="w-80 rounded border border-zinc-300 px-3 py-2"
                    aria-label="Search"
                />
                <select name="status" defaultValue={status ?? ""} className="rounded border border-zinc-300 px-3 py-2" aria-label="Status">
                    <option value="">all but merged and superseded</option>
                    {STATUSES.map(s => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
                <button className="rounded border border-zinc-900 px-4 py-2">Filter</button>
            </form>
            <ul className="space-y-2">
                {findings.map(f => (
                    <li key={f.id}>
                        <details className="rounded border border-zinc-200 bg-white">
                            <summary className="cursor-pointer px-4 py-2">
                                <span className="font-mono">{f.label}</span> · <b>{f.severity ?? "question"}</b> · {f.title}{" "}
                                <span className="text-sm text-zinc-500">
                                    {f.aspect} · {f.source} · {f.status}
                                </span>
                            </summary>
                            <div className="space-y-3 border-t border-zinc-200 px-4 py-3 text-sm">
                                {(f.evidence as { file: string; startLine: number; endLine: number; snippet?: string }[]).map((e, i) => (
                                    <div key={i}>
                                        <p className="font-mono text-xs">
                                            {e.file}:{e.startLine}-{e.endLine}
                                        </p>
                                        {e.snippet && <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs">{e.snippet}</pre>}
                                    </div>
                                ))}
                                {f.likelihood && <p>Likelihood: {f.likelihood}</p>}
                                {f.impact && <p>Impact: {f.impact}</p>}
                                <p>{f.summary}</p>
                                <p className="whitespace-pre-wrap text-zinc-700">{f.explanation}</p>
                                <p>Recommendation: {f.recommendation}</p>
                                {f.statusReason && <p className="text-zinc-500">Reason: {f.statusReason}</p>}
                                <div className="flex flex-wrap gap-3">
                                    <ActionForm action={acceptAction.bind(null, f.id)}>
                                        <button className="rounded bg-emerald-700 px-3 py-1 text-white">Accept</button>
                                    </ActionForm>
                                    <ActionForm action={excludeAction.bind(null, f.id)} className="flex flex-wrap gap-2">
                                        <input
                                            name="reason"
                                            required
                                            placeholder="Why it stays out of the report"
                                            className="rounded border border-zinc-300 px-2"
                                        />
                                        <button className="rounded border border-zinc-400 px-3 py-1">Exclude</button>
                                    </ActionForm>
                                    <ActionForm action={rejectAction.bind(null, f.id)} className="flex flex-wrap gap-2">
                                        <input
                                            name="reason"
                                            required
                                            placeholder="Why it is wrong"
                                            className="rounded border border-zinc-300 px-2"
                                        />
                                        <button className="rounded border border-red-700 px-3 py-1 text-red-700">Reject</button>
                                    </ActionForm>
                                    <Link href={`/projects/${projectId}/findings/${f.number}`} className="self-center underline">
                                        Edit or merge
                                    </Link>
                                </div>
                            </div>
                        </details>
                    </li>
                ))}
                {!findings.length && <li className="text-zinc-500">No findings match.</li>}
            </ul>
        </div>
    );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/app/ActionForm";
import { acceptAction, excludeAction, rejectAction } from "@/app/review-actions";
import { Badge, FindingStatus, Icon, PageHeader, SeverityBadge, button, field, input } from "@/app/ui";
import { prisma } from "@/server/db";
import { listFindings } from "@/server/review";

export const dynamic = "force-dynamic";

const STATUSES = ["unreviewed", "accepted", "edited", "rejected", "excluded", "merged", "superseded"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{title}</div>
            <div className="mt-1 text-zinc-800">{children}</div>
        </div>
    );
}

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
            <PageHeader
                eyebrow={
                    <Link href={`/projects/${projectId}`} className="hover:underline">
                        {project.name}
                    </Link>
                }
                title="Findings"
                actions={
                    <a href={`/projects/${projectId}/report`} className={button.secondary}>
                        <Icon name="download" />
                        Download report
                    </a>
                }
            >
                <span className="flex flex-wrap gap-1.5">
                    {counts.map(c => (
                        <span key={c.status} className="inline-flex items-center gap-1">
                            <FindingStatus status={c.status} />
                            <span className="text-xs text-zinc-500 tabular-nums">{c._count._all}</span>
                        </span>
                    ))}
                </span>
            </PageHeader>

            <form className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                <div className="relative min-w-64 flex-1">
                    <Icon name="search" className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-400" />
                    <input
                        name="q"
                        defaultValue={q}
                        placeholder="Search titles, explanations, evidence"
                        className={`${input} pl-9`}
                        aria-label="Search"
                    />
                </div>
                <select name="status" defaultValue={status ?? ""} className={`${field} w-64`} aria-label="Status">
                    <option value="">all but merged and superseded</option>
                    {STATUSES.map(s => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
                <button className={button.secondary}>Filter</button>
            </form>

            <ul className="space-y-3">
                {findings.map(f => (
                    <li key={f.id}>
                        <details className="group rounded-xl border border-zinc-200 bg-white shadow-sm open:ring-1 open:ring-indigo-200">
                            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                                <SeverityBadge severity={f.severity} />
                                <span className="font-mono text-xs text-zinc-500">{f.label}</span>
                                <span className="min-w-0 flex-1 text-sm font-medium text-zinc-900">{f.title}</span>
                                <span className="hidden items-center gap-1.5 md:flex">
                                    <Badge tone="slate">{f.aspect}</Badge>
                                    <Badge tone="slate">{f.source}</Badge>
                                </span>
                                <FindingStatus status={f.status} />
                                <svg
                                    aria-hidden
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    className="size-4 text-zinc-400 transition group-open:rotate-180"
                                >
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </summary>
                            <div className="grid gap-6 border-t border-zinc-100 px-5 py-5 text-sm md:grid-cols-5">
                                <div className="space-y-4 md:col-span-3">
                                    <Section title="Summary">{f.summary}</Section>
                                    {(f.likelihood || f.impact) && (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {f.likelihood && <Section title="Likelihood">{f.likelihood}</Section>}
                                            {f.impact && <Section title="Impact">{f.impact}</Section>}
                                        </div>
                                    )}
                                    <Section title="Explanation">
                                        <span className="whitespace-pre-wrap text-zinc-700">{f.explanation}</span>
                                    </Section>
                                    <div className="rounded-lg bg-emerald-50 px-3.5 py-3 ring-1 ring-emerald-600/15 ring-inset">
                                        <div className="text-xs font-medium tracking-wide text-emerald-800 uppercase">Recommendation</div>
                                        <p className="mt-1 text-emerald-950">{f.recommendation}</p>
                                    </div>
                                    {f.statusReason && (
                                        <p className="text-zinc-500">
                                            <span className="font-medium">Reason:</span> {f.statusReason}
                                        </p>
                                    )}
                                </div>
                                <div className="space-y-3 md:col-span-2">
                                    <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Evidence</div>
                                    {(f.evidence as { file: string; startLine: number; endLine: number; snippet?: string }[]).map(
                                        (e, i) => (
                                            <div key={i} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                                                <div className="border-b border-zinc-800 px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                                                    {e.file}:{e.startLine}-{e.endLine}
                                                </div>
                                                {e.snippet && (
                                                    <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-zinc-100">
                                                        {e.snippet}
                                                    </pre>
                                                )}
                                            </div>
                                        )
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-start gap-2 rounded-b-xl border-t border-zinc-100 bg-zinc-50/70 px-4 py-3">
                                <ActionForm action={acceptAction.bind(null, f.id)}>
                                    <button className={`${button.success} ${button.small}`}>Accept</button>
                                </ActionForm>
                                <ActionForm action={excludeAction.bind(null, f.id)} className="flex flex-wrap gap-2">
                                    <input
                                        name="reason"
                                        required
                                        placeholder="Why it stays out of the report"
                                        className={`${field} w-56 py-1.5 text-xs`}
                                    />
                                    <button className={`${button.secondary} ${button.small}`}>Exclude</button>
                                </ActionForm>
                                <ActionForm action={rejectAction.bind(null, f.id)} className="flex flex-wrap gap-2">
                                    <input
                                        name="reason"
                                        required
                                        placeholder="Why it is wrong"
                                        className={`${field} w-48 py-1.5 text-xs`}
                                    />
                                    <button className={`${button.danger} ${button.small}`}>Reject</button>
                                </ActionForm>
                                <Link
                                    href={`/projects/${projectId}/findings/${f.number}`}
                                    className="ml-auto self-center text-sm font-medium text-indigo-700 hover:underline"
                                >
                                    Edit or merge
                                </Link>
                            </div>
                        </details>
                    </li>
                ))}
                {!findings.length && (
                    <li className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-sm text-zinc-500">
                        No findings match.
                    </li>
                )}
            </ul>
        </div>
    );
}

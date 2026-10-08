import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/app/ActionForm";
import { ReportExport } from "@/app/ReportExport";
import { acceptAction, confirmRecheckAction, excludeAction, rejectAction } from "@/app/review-actions";
import { Badge, FindingStatus, Icon, PageHeader, RecheckBadge, SeverityBadge, button, field, input, select } from "@/app/ui";
import { ASPECTS, aspectTitle } from "@/engine/aspects";
import { hoursOf, sizeAndHours } from "@/engine/effort";
import { prisma } from "@/server/db";
import { listFindings } from "@/server/review";

export const dynamic = "force-dynamic";

const STATUSES = ["unreviewed", "accepted", "edited", "rejected", "excluded", "merged", "superseded"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{title}</div>
            <div className="mt-1 whitespace-pre-wrap text-zinc-800">{children}</div>
        </div>
    );
}

export default async function FindingsPage({
    params,
    searchParams
}: {
    params: Promise<{ projectId: string }>;
    searchParams: Promise<{ q?: string; status?: string; aspect?: string; recheck?: string }>;
}) {
    const { projectId } = await params;
    const { q, status, aspect, recheck } = await searchParams;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) notFound();
    const findings = await listFindings(projectId, {
        q: q || undefined,
        status: status || undefined,
        aspect: aspect || undefined,
        recheck: recheck || undefined
    });
    const toVerify = await prisma.finding.count({ where: { projectId, recheck: "changed", status: { in: ["accepted", "edited"] } } });
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
                actions={<ReportExport projectId={projectId} />}
            >
                <span className="flex flex-wrap gap-1.5">
                    {toVerify > 0 && (
                        <Link
                            href={`/projects/${projectId}/findings?recheck=changed`}
                            className="text-xs font-medium text-sky-700 hover:underline"
                        >
                            {toVerify} to verify after the re-audit
                        </Link>
                    )}
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
                <select name="status" defaultValue={status ?? ""} className={`${select} w-64`} aria-label="Status">
                    <option value="">all but merged and superseded</option>
                    {STATUSES.map(s => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
                <select name="aspect" defaultValue={aspect ?? ""} className={`${select} w-64`} aria-label="Aspect">
                    <option value="">every aspect</option>
                    {ASPECTS.map(a => (
                        <option key={a.key} value={a.key}>
                            {a.title}
                        </option>
                    ))}
                </select>
                <button className={button.secondary}>Filter</button>
            </form>

            <ul className="space-y-3">
                {findings.map(f => (
                    <li key={f.id}>
                        <details className="group rounded-xl border border-zinc-200 bg-white shadow-sm open:ring-1 open:ring-indigo-200">
                            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:flex-nowrap [&::-webkit-details-marker]:hidden">
                                <SeverityBadge severity={f.severity} />
                                <span className="font-mono text-xs text-zinc-500">{f.label}</span>
                                <span className="order-last min-w-0 basis-full text-sm font-medium text-zinc-900 sm:order-none sm:flex-1 sm:basis-0">
                                    {f.title}
                                </span>
                                <span className="hidden items-center gap-1.5 md:flex">
                                    <Badge tone="slate">{aspectTitle(f.aspect)}</Badge>
                                    <Badge tone="slate">{f.source}</Badge>
                                    {f.effort && <Badge tone="slate">{sizeAndHours(f.effort, hoursOf(f))}</Badge>}
                                </span>
                                <span className="ml-auto flex items-center gap-3">
                                    <RecheckBadge recheck={f.recheck} sha={f.recheckedSha} />
                                    <FindingStatus status={f.status} />
                                </span>
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
                            <div className="grid grid-cols-1 gap-6 border-t border-zinc-100 px-5 py-5 text-sm md:grid-cols-5">
                                <div className="space-y-4 md:col-span-3">
                                    <Section title="Summary">{f.summary}</Section>
                                    {(f.likelihood || f.impact) && (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {f.likelihood && <Section title="Likelihood">{f.likelihood}</Section>}
                                            {f.impact && <Section title="Impact">{f.impact}</Section>}
                                        </div>
                                    )}
                                    <Section title="Explanation">
                                        <span className="text-zinc-700">{f.explanation}</span>
                                    </Section>
                                    <div className="rounded-lg bg-emerald-50 px-3.5 py-3 ring-1 ring-emerald-600/15 ring-inset">
                                        <div className="text-xs font-medium tracking-wide text-emerald-800 uppercase">Recommendation</div>
                                        <p data-testid="recommendation" className="mt-1 whitespace-pre-wrap text-emerald-950">
                                            {f.recommendation}
                                        </p>
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
                                                <div className="border-b border-zinc-800 px-3 py-1.5 font-mono text-[11px] break-all text-zinc-400">
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
                                <ActionForm action={acceptAction.bind(null, f.id)} className="flex flex-wrap gap-2">
                                    <SubmitButton disabled={f.status === "accepted"} className={`${button.success} ${button.small}`}>
                                        {f.status === "accepted" ? (
                                            <>
                                                <Icon name="check" className="size-3.5" />
                                                Accepted
                                            </>
                                        ) : (
                                            "Accept"
                                        )}
                                    </SubmitButton>
                                </ActionForm>
                                <ActionForm action={excludeAction.bind(null, f.id)} className="flex flex-wrap gap-2">
                                    <input
                                        name="reason"
                                        required
                                        placeholder="Why it stays out of the report"
                                        className={`${field} w-56 py-1.5 text-xs`}
                                    />
                                    <SubmitButton className={`${button.secondary} ${button.small}`}>Exclude</SubmitButton>
                                </ActionForm>
                                <ActionForm action={rejectAction.bind(null, f.id)} className="flex flex-wrap gap-2">
                                    <input
                                        name="reason"
                                        required
                                        placeholder="Why it is wrong"
                                        className={`${field} w-48 py-1.5 text-xs`}
                                    />
                                    <SubmitButton className={`${button.danger} ${button.small}`}>Reject</SubmitButton>
                                </ActionForm>
                                {f.recheck && (
                                    <>
                                        <ActionForm
                                            action={confirmRecheckAction.bind(null, f.id, "fixed")}
                                            className="flex flex-wrap gap-2"
                                        >
                                            <SubmitButton className={`${button.secondary} ${button.small}`}>Verified fixed</SubmitButton>
                                        </ActionForm>
                                        <ActionForm action={confirmRecheckAction.bind(null, f.id, "open")} className="flex flex-wrap gap-2">
                                            <SubmitButton className={`${button.secondary} ${button.small}`}>Still open</SubmitButton>
                                        </ActionForm>
                                    </>
                                )}
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

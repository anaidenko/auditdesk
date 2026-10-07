import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/app/ActionForm";
import { editAction, mergeAction } from "@/app/review-actions";
import { Card, FindingStatus, PageHeader, SeverityBadge, button, input, label } from "@/app/ui";
import { findingLabel } from "@/engine/findings";
import { SEVERITIES } from "@/engine/types";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

const field = `${input} mt-1.5`;

export default async function FindingPage({ params }: { params: Promise<{ projectId: string; number: string }> }) {
    const { projectId, number } = await params;
    const f = await prisma.finding.findUnique({ where: { projectId_number: { projectId, number: Number(number) } } });
    if (!f) notFound();
    const question = f.kind === "question";
    return (
        <div className="max-w-3xl space-y-6">
            <PageHeader
                eyebrow={
                    <Link href={`/projects/${projectId}/findings`} className="hover:underline">
                        Findings · {findingLabel(f.number)}
                    </Link>
                }
                title={f.title}
            >
                <span className="flex items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <FindingStatus status={f.status} />
                </span>
            </PageHeader>

            <Card
                title="Edit"
                description="An unreviewed or accepted finding becomes edited and goes into the report; a rejected or excluded one keeps its status."
            >
                <ActionForm action={editAction.bind(null, f.id)} className="space-y-4 text-sm">
                    <label className={label}>
                        Title
                        <input name="title" defaultValue={f.title} required className={field} />
                    </label>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <label className={label}>
                            Severity
                            <select name="severity" defaultValue={f.severity ?? ""} disabled={question} className={field}>
                                {SEVERITIES.map(s => (
                                    <option key={s}>{s}</option>
                                ))}
                            </select>
                        </label>
                        <label className={label}>
                            Effort
                            <select name="effort" defaultValue={f.effort ?? ""} className={field}>
                                <option value="">—</option>
                                <option>S</option>
                                <option>M</option>
                                <option>L</option>
                            </select>
                        </label>
                        <label className={label}>
                            Hours
                            <input name="effortHours" type="number" min="0" defaultValue={f.effortHours ?? ""} className={field} />
                        </label>
                        <label className={label}>
                            Sign-off
                            <select
                                name="signoff"
                                defaultValue={f.fixBeforeSignoff === null ? "" : f.fixBeforeSignoff ? "before" : "later"}
                                disabled={question}
                                className={field}
                            >
                                <option value="">By severity</option>
                                <option value="before">Fix before sign-off</option>
                                <option value="later">Can wait</option>
                            </select>
                        </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        {(["likelihood", "impact"] as const).map(k => (
                            <label key={k} className={label}>
                                {k}
                                <input name={k} defaultValue={f[k] ?? ""} className={field} />
                            </label>
                        ))}
                    </div>
                    {(["summary", "explanation", "recommendation", "note"] as const).map(k => (
                        <label key={k} className={label}>
                            {k === "note" ? "Note (yours, never in the report)" : k}
                            <textarea
                                name={k}
                                defaultValue={f[k] ?? ""}
                                rows={k === "explanation" ? 8 : 3}
                                required={k !== "note"}
                                className={field}
                            />
                        </label>
                    ))}
                    <button className={button.primary}>Save</button>
                </ActionForm>
            </Card>

            <Card title="Merge" description="Fold this finding into another one: its evidence moves there, and this one leaves the review.">
                <ActionForm action={mergeAction.bind(null, f.id)} className="flex flex-wrap items-end gap-3 text-sm">
                    <label className={`${label} w-40`}>
                        Merge into
                        <input name="target" placeholder="F-012" required className={field} />
                    </label>
                    <button className={button.secondary}>Merge</button>
                </ActionForm>
            </Card>
        </div>
    );
}

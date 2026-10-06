import { notFound } from "next/navigation";

import { ActionForm } from "@/app/ActionForm";
import { editAction, mergeAction } from "@/app/review-actions";
import { findingLabel } from "@/engine/findings";
import { SEVERITIES } from "@/engine/types";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded border border-zinc-300 px-3 py-2";

export default async function FindingPage({ params }: { params: Promise<{ projectId: string; number: string }> }) {
    const { projectId, number } = await params;
    const f = await prisma.finding.findUnique({ where: { projectId_number: { projectId, number: Number(number) } } });
    if (!f) notFound();
    const question = f.kind === "question";
    return (
        <div className="max-w-3xl space-y-8">
            <h1 className="text-2xl font-semibold">
                {findingLabel(f.number)} · {f.status}
            </h1>
            <ActionForm action={editAction.bind(null, f.id)} className="space-y-4 text-sm">
                <label className="block">
                    Title
                    <input name="title" defaultValue={f.title} required className={field} />
                </label>
                <div className="flex gap-4">
                    <label>
                        Severity
                        <select name="severity" defaultValue={f.severity ?? ""} disabled={question} className={field}>
                            {SEVERITIES.map(s => (
                                <option key={s}>{s}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Effort
                        <select name="effort" defaultValue={f.effort ?? ""} className={field}>
                            <option value="">—</option>
                            <option>S</option>
                            <option>M</option>
                            <option>L</option>
                        </select>
                    </label>
                    <label>
                        Hours
                        <input name="effortHours" type="number" min="0" defaultValue={f.effortHours ?? ""} className={field} />
                    </label>
                </div>
                {(["likelihood", "impact"] as const).map(k => (
                    <label key={k} className="block capitalize">
                        {k}
                        <input name={k} defaultValue={f[k] ?? ""} className={field} />
                    </label>
                ))}
                {(["summary", "explanation", "recommendation", "note"] as const).map(k => (
                    <label key={k} className="block capitalize">
                        {k}
                        <textarea
                            name={k}
                            defaultValue={f[k] ?? ""}
                            rows={k === "explanation" ? 8 : 3}
                            required={k !== "note"}
                            className={field}
                        />
                    </label>
                ))}
                <button className="rounded bg-zinc-900 px-4 py-2 text-white">Save</button>
                <p className="text-zinc-500">
                    An unreviewed or accepted finding becomes edited and goes into the report; a rejected or excluded one keeps its status.
                </p>
            </ActionForm>
            <ActionForm action={mergeAction.bind(null, f.id)} className="flex flex-wrap items-end gap-3 text-sm">
                <label>
                    Merge into
                    <input name="target" placeholder="F-012" required className={field} />
                </label>
                <button className="rounded border border-zinc-900 px-4 py-2">Merge</button>
            </ActionForm>
        </div>
    );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { rerunAspect } from "@/app/review-actions";
import { prisma } from "@/server/db";

import { RunProgress } from "./RunProgress";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
    const { runId } = await params;
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { project: true, agents: true } });
    if (!run) notFound();
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">
                Run of <Link href={`/projects/${run.projectId}`}>{run.project.name}</Link>
            </h1>
            <RunProgress runId={run.id} />
            {run.status !== "queued" && run.status !== "running" && (
                <ul className="space-y-2 text-sm">
                    {run.agents.map(a => (
                        <li key={a.id}>
                            <form action={rerunAspect.bind(null, run.id, a.repositoryId, a.aspect)} className="flex items-center gap-3">
                                <span>
                                    {a.aspect}: {a.status}
                                </span>
                                <button className="rounded border border-zinc-900 px-3 py-1">Re-run this aspect</button>
                                <span className="text-zinc-500">
                                    Unreviewed findings of this aspect are replaced and their IDs left as gaps; reviewed ones reach the
                                    agent as known.
                                </span>
                            </form>
                        </li>
                    ))}
                </ul>
            )}
            <Link href={`/projects/${run.projectId}/findings`} className="underline">
                Review the findings
            </Link>
        </div>
    );
}

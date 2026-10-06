import Link from "next/link";
import { notFound } from "next/navigation";

import { rerunAspect } from "@/app/review-actions";
import { prisma } from "@/server/db";

import { RunProgress } from "./RunProgress";

export const dynamic = "force-dynamic";

export default async function RunPage({
    params,
    searchParams
}: {
    params: Promise<{ runId: string }>;
    searchParams: Promise<{ notice?: string }>;
}) {
    const { runId } = await params;
    const { notice } = await searchParams;
    const run = await prisma.run.findUnique({
        where: { id: runId },
        include: {
            project: { include: { repositories: true } },
            agents: { orderBy: { createdAt: "asc" } },
            _count: { select: { jobs: true } }
        }
    });
    if (!run) notFound();
    // One row per repository and aspect, with its latest agent: a re-run adds a second agent, and a run
    // interrupted before its agents started has none, yet each can be re-run (design § 9).
    const latest = new Map(run.agents.map(a => [`${a.repositoryId}:${a.aspect}`, a]));
    const targets = run.project.repositories.flatMap(r =>
        run.aspects.map(aspect => ({ repositoryId: r.id, aspect, status: latest.get(`${r.id}:${aspect}`)?.status ?? "not started" }))
    );
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">
                Run of <Link href={`/projects/${run.projectId}`}>{run.project.name}</Link>
            </h1>
            {notice === "busy" && (
                <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Another run of this project is queued or running; re-run this aspect when it ends.
                </p>
            )}
            {/* A re-run adds a job: the new key starts a fresh stream, where the old one had ended on "done". */}
            <RunProgress key={run._count.jobs} runId={run.id} />
            {run.status !== "queued" && run.status !== "running" && (
                <ul className="space-y-2 text-sm">
                    {targets.map(a => (
                        <li key={`${a.repositoryId}:${a.aspect}`}>
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

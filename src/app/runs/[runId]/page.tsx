import Link from "next/link";
import { notFound } from "next/navigation";

import { rerunAspect } from "@/app/review-actions";
import { Alert, Card, Icon, PageHeader, RunStatus, button } from "@/app/ui";
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
    const repoName = new Map(
        run.project.repositories.map(r => [
            r.id,
            r.source
                .split(/[/:]/)
                .at(-1)
                ?.replace(/\.git$/, "") ?? r.source
        ])
    );
    const targets = run.project.repositories.flatMap(r =>
        run.aspects.map(aspect => ({ repositoryId: r.id, aspect, status: latest.get(`${r.id}:${aspect}`)?.status ?? "not started" }))
    );
    return (
        <div className="space-y-8">
            <PageHeader
                eyebrow={
                    <Link href={`/projects/${run.projectId}`} className="hover:underline">
                        {run.project.name}
                    </Link>
                }
                title="Run"
                actions={
                    <Link href={`/projects/${run.projectId}/findings`} className={button.primary}>
                        Review the findings
                        <Icon name="arrow" />
                    </Link>
                }
            >
                {run.model} · effort {run.effort} · cap ${Number(run.budgetUsd).toFixed(2)} · started{" "}
                {(run.startedAt ?? run.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
            </PageHeader>
            {notice === "busy" && <Alert>Another run of this project is queued or running; re-run this aspect when it ends.</Alert>}
            {notice === "access" && <Alert>This run used another model access than the project uses now; start a new run.</Alert>}
            {/* A re-run adds a job: the new key starts a fresh stream, where the old one had ended on "done". */}
            <RunProgress key={run._count.jobs} runId={run.id} />
            {run.status !== "queued" && run.status !== "running" && (
                <Card
                    as="section"
                    title="Aspects"
                    description="Re-running an aspect replaces its unreviewed findings, leaving their IDs as gaps; reviewed ones reach the agent as known."
                >
                    <ul className="divide-y divide-zinc-100">
                        {targets.map(a => (
                            <li key={`${a.repositoryId}:${a.aspect}`}>
                                <form
                                    action={rerunAspect.bind(null, run.id, a.repositoryId, a.aspect)}
                                    className="flex flex-wrap items-center gap-3 py-2.5 text-sm"
                                >
                                    <span className="font-medium capitalize">{a.aspect}</span>
                                    <span className="font-mono text-xs text-zinc-500">{repoName.get(a.repositoryId)}</span>
                                    <RunStatus status={a.status} />
                                    <button className={`${button.secondary} ${button.small} ml-auto`}>
                                        <Icon name="refresh" className="size-3.5" />
                                        Re-run this aspect
                                    </button>
                                </form>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}

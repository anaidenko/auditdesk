import Link from "next/link";
import { notFound } from "next/navigation";

import { rerunAspect } from "@/app/review-actions";
import { Alert, Card, Icon, PageHeader, RunStatus, button } from "@/app/ui";
import { SEAMS, aspectTitle } from "@/engine/aspects";
import { overReserve, readPlanUsage } from "@/engine/plan-usage";
import { prisma } from "@/server/db";

import { RunProgress } from "./RunProgress";
import { runTargets } from "./targets";

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
            project: { include: { repositories: { orderBy: { createdAt: "asc" } } } },
            agents: { orderBy: { createdAt: "asc" } },
            _count: { select: { jobs: true } }
        }
    });
    if (!run) notFound();
    const repoName = new Map(
        run.project.repositories.map(r => [
            r.id,
            r.source
                .split(/[/:]/)
                .at(-1)
                ?.replace(/\.git$/, "") ?? r.source
        ])
    );
    // A re-run is a new start: above the reserve it asks again (Task E.7a).
    const askReserve = run.modelAccess === "claude_plan" && overReserve(await readPlanUsage());
    // Re-runs belong to the project's latest run, and only while its cap has room (as enqueueRerun checks).
    const newer = await prisma.run.count({ where: { projectId: run.projectId, createdAt: { gt: run.createdAt } } });
    const spent = Number((await prisma.apiCall.aggregate({ where: { runId: run.id }, _sum: { costUsd: true } }))._sum.costUsd ?? 0);
    const noRerun = newer
        ? "Re-runs belong to the project's latest run: this one's would take the report back to the commit it audited."
        : spent >= Number(run.budgetUsd)
          ? `This run has spent its cap ($${spent.toFixed(2)} of $${Number(run.budgetUsd).toFixed(2)}): start a new run for an aspect.`
          : null;
    // The repositories the run was started with: a re-run neither clones nor counts one added since.
    const targets = runTargets(
        run.project.repositories.filter(r => r.createdAt <= run.createdAt),
        run.aspects,
        run.agents
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
                {run.model} · effort {run.effort} · cap ${Number(run.budgetUsd).toFixed(2)}
                {run.modelAccess === "claude_plan" ? " API-equivalent" : ""} · started{" "}
                {(run.startedAt ?? run.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
            </PageHeader>
            {notice === "busy" && <Alert>Another run of this project is queued or running; re-run this aspect when it ends.</Alert>}
            {notice === "access" && <Alert>This run used another model access than the project uses now; start a new run.</Alert>}
            {notice === "stale" && <Alert>A newer run of this project exists: re-run the aspect from it, or start a new run.</Alert>}
            {notice === "spent" && <Alert>This run has spent its cap: start a new run for this aspect.</Alert>}
            {notice === "reserve" && (
                <Alert>
                    The Claude plan&apos;s 5-hour usage is above the 50% reserve. Tick &quot;Allow past the 50% reserve&quot; to re-run now.
                </Alert>
            )}
            {/* A re-run adds a job: the new key starts a fresh stream, where the old one had ended on "done". */}
            <RunProgress key={run._count.jobs} runId={run.id} />
            {run.status !== "queued" && run.status !== "running" && (
                <Card
                    as="section"
                    title="Aspects"
                    description="Re-running an aspect replaces its unreviewed findings, leaving their IDs as gaps; reviewed ones reach the agent as known."
                >
                    {noRerun && <p className="text-sm text-zinc-600">{noRerun}</p>}
                    <ul className="divide-y divide-zinc-100">
                        {(noRerun ? [] : targets).map(a => (
                            <li key={`${a.repositoryId}:${a.aspect}`}>
                                <form
                                    action={rerunAspect.bind(null, run.id, a.repositoryId, a.aspect)}
                                    className="flex flex-wrap items-center gap-3 py-2.5 text-sm"
                                >
                                    <span className="font-medium">{aspectTitle(a.aspect)}</span>
                                    <span className="font-mono text-xs text-zinc-500">
                                        {a.aspect === SEAMS ? "every repository" : repoName.get(a.repositoryId)}
                                    </span>
                                    <RunStatus status={a.status} />
                                    {askReserve && (
                                        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-amber-800">
                                            <input
                                                type="checkbox"
                                                name="allowPastReserve"
                                                className="size-4 rounded border-zinc-300 accent-amber-600"
                                            />
                                            Allow past the 50% reserve
                                        </label>
                                    )}
                                    <button className={`${button.secondary} ${button.small} ${askReserve ? "" : "ml-auto"}`}>
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

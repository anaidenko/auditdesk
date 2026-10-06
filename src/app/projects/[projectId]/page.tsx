import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteProject, setConsent } from "@/app/actions";
import { Badge, Card, Icon, PageHeader, RunStatus, button } from "@/app/ui";
import { getProject } from "@/server/queries";

import { AddRepositoryForm, StartRunForm } from "./forms";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const project = await getProject(projectId);
    if (!project) notFound();
    const defaults = { usd: Number(process.env.DEFAULT_BUDGET_USD ?? 10), tokens: Number(process.env.DEFAULT_BUDGET_TOKENS ?? 400000) };
    const active = project.runs.some(r => r.status === "queued" || r.status === "running");
    return (
        <div className="space-y-8">
            <PageHeader
                eyebrow="Project"
                title={project.name}
                actions={
                    <>
                        <Link href={`/projects/${project.id}/findings`} className={button.secondary}>
                            <Icon name="list" />
                            Findings
                        </Link>
                        <a href={`/projects/${project.id}/report`} className={button.secondary}>
                            <Icon name="download" />
                            Download report
                        </a>
                    </>
                }
            >
                Created {project.createdAt.toISOString().slice(0, 10)} · {project.repositories.length}{" "}
                {project.repositories.length === 1 ? "repository" : "repositories"}
            </PageHeader>

            <div className="grid items-start gap-6 lg:grid-cols-5">
                <div className="space-y-6 lg:col-span-3">
                    <Card
                        as="section"
                        title="Repositories"
                        description="Cloned read-only for each audit; nothing in them is installed or executed."
                    >
                        {project.repositories.length > 0 && (
                            <ul className="mb-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                                {project.repositories.map(r => (
                                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-sm">
                                        <Icon name="branch" className="size-4 shrink-0 text-zinc-400" />
                                        <span className="min-w-0 flex-1 font-mono text-[13px] break-all text-zinc-800">{r.source}</span>
                                        <Badge tone="slate">{r.branch}</Badge>
                                        {r.commitSha && <code className="text-xs text-zinc-400">{r.commitSha.slice(0, 10)}</code>}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <AddRepositoryForm projectId={project.id} />
                    </Card>

                    <Card
                        as="section"
                        title="Client's AI consent"
                        description="Required before any audit: it records that the client agreed to an AI review of their code."
                    >
                        <form action={setConsent.bind(null, project.id)} className="flex flex-wrap items-center gap-3 text-sm">
                            <label className="flex flex-1 items-start gap-2.5 text-zinc-700">
                                <input
                                    type="checkbox"
                                    name="consent"
                                    defaultChecked={!!project.aiConsentAt}
                                    className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
                                />
                                The client agreed that their code may be sent to the Claude API for this audit.
                            </label>
                            <button className={`${button.secondary} ${button.small}`}>Save</button>
                            {project.aiConsentAt ? (
                                <Badge tone="emerald" dot>
                                    recorded {project.aiConsentAt.toISOString().slice(0, 10)}
                                </Badge>
                            ) : (
                                <Badge tone="amber" dot>
                                    not recorded
                                </Badge>
                            )}
                        </form>
                    </Card>
                </div>

                <div className="space-y-6 lg:col-span-2">
                    <Card as="section" title="Runs" description="Scanners, the repository map, then one agent per aspect.">
                        <StartRunForm projectId={project.id} defaults={defaults} />
                        {project.runs.length > 0 && (
                            <ul className="mt-5 space-y-1 border-t border-zinc-100 pt-4">
                                {project.runs.map(r => (
                                    <li key={r.id}>
                                        <Link
                                            href={`/runs/${r.id}`}
                                            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50"
                                        >
                                            <span className="font-mono text-[13px] text-zinc-700">{when(r.createdAt)}</span>
                                            <RunStatus status={r.status} />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>

                    <Card title="Danger zone">
                        {active ? (
                            <p className="text-sm text-zinc-500">Stop the run before deleting the project.</p>
                        ) : (
                            <form action={deleteProject.bind(null, project.id)} className="flex items-center justify-between gap-3">
                                <span className="text-sm text-zinc-500">Deletes the project, its findings and its clones.</span>
                                <button className={`${button.danger} ${button.small}`}>Delete project and its clones</button>
                            </form>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}

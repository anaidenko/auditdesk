import Link from "next/link";

import { listProjects } from "@/server/queries";

import { NewProjectForm } from "./NewProjectForm";
import { ACCESS_LABEL } from "./model-access";
import { Badge, Card, Icon, PageHeader } from "./ui";

export const dynamic = "force-dynamic";

export default async function Home() {
    const projects = await listProjects();
    return (
        <div className="space-y-8">
            <PageHeader title="Projects">One project per client audit: its repositories, runs, findings and the report.</PageHeader>
            <Card title="New project" description="Name it after the client or the codebase you audit.">
                <NewProjectForm />
            </Card>
            {projects.length ? (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {projects.map(p => (
                        <li key={p.id}>
                            <Link
                                href={`/projects/${p.id}`}
                                className="group flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                                        <Icon name="folder" />
                                    </span>
                                    <span className="flex flex-wrap justify-end gap-1.5">
                                        <Badge tone="slate">{ACCESS_LABEL[p.modelAccess]}</Badge>
                                        {p.aiConsentAt ? (
                                            <Badge tone="emerald" dot>
                                                consent recorded
                                            </Badge>
                                        ) : (
                                            <Badge tone="amber" dot>
                                                no consent yet
                                            </Badge>
                                        )}
                                    </span>
                                </div>
                                <span className="mt-4 font-semibold text-zinc-900 group-hover:text-indigo-700">{p.name}</span>
                                <span className="mt-1 text-sm text-zinc-500">
                                    {p._count.runs} {p._count.runs === 1 ? "run" : "runs"} · {p._count.findings}{" "}
                                    {p._count.findings === 1 ? "finding" : "findings"}
                                </span>
                                <span className="mt-auto pt-4 text-xs text-zinc-400">Created {p.createdAt.toISOString().slice(0, 10)}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center text-sm text-zinc-500">
                    No projects yet. Create one above, add a repository, record the client&apos;s consent, and start a run.
                </div>
            )}
        </div>
    );
}

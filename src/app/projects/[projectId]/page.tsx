import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteProject, setConsent } from "@/app/actions";
import { getProject } from "@/server/queries";

import { AddRepositoryForm, StartRunForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const project = await getProject(projectId);
    if (!project) notFound();
    const defaults = { usd: Number(process.env.DEFAULT_BUDGET_USD ?? 10), tokens: Number(process.env.DEFAULT_BUDGET_TOKENS ?? 400000) };
    return (
        <div className="space-y-10">
            <div className="flex items-baseline justify-between">
                <h1 className="text-2xl font-semibold">{project.name}</h1>
                <nav className="flex gap-4 text-sm">
                    <Link href={`/projects/${project.id}/findings`} className="underline">
                        Findings
                    </Link>
                    <a href={`/projects/${project.id}/report`} className="underline">
                        Download report
                    </a>
                </nav>
            </div>

            <section className="space-y-3">
                <h2 className="font-semibold">Repositories</h2>
                <ul className="text-sm">
                    {project.repositories.map(r => (
                        <li key={r.id}>
                            {r.source} @ {r.branch} {r.commitSha && <code className="text-zinc-500">{r.commitSha.slice(0, 10)}</code>}
                        </li>
                    ))}
                </ul>
                <AddRepositoryForm projectId={project.id} />
            </section>

            <section className="space-y-3">
                <h2 className="font-semibold">Client&apos;s AI consent</h2>
                <form action={setConsent.bind(null, project.id)} className="flex items-center gap-3 text-sm">
                    <label className="flex items-center gap-2">
                        <input type="checkbox" name="consent" defaultChecked={!!project.aiConsentAt} />
                        The client agreed that their code may be sent to the Claude API for this audit.
                    </label>
                    <button className="rounded border border-zinc-300 px-3 py-1">Save</button>
                    {project.aiConsentAt && (
                        <span className="text-zinc-500">recorded {project.aiConsentAt.toISOString().slice(0, 10)}</span>
                    )}
                </form>
            </section>

            <section className="space-y-3">
                <h2 className="font-semibold">Runs</h2>
                <StartRunForm projectId={project.id} defaults={defaults} />
                <ul className="text-sm">
                    {project.runs.map(r => (
                        <li key={r.id}>
                            <Link href={`/runs/${r.id}`} className="underline">
                                {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                            </Link>{" "}
                            · {r.status}
                        </li>
                    ))}
                </ul>
            </section>

            {project.runs.some(r => r.status === "queued" || r.status === "running") ? (
                <p className="text-sm text-zinc-500">Stop the run before deleting the project.</p>
            ) : (
                <form action={deleteProject.bind(null, project.id)}>
                    <button className="text-sm text-red-700 underline">Delete project and its clones</button>
                </form>
            )}
        </div>
    );
}

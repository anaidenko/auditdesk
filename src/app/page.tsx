import Link from "next/link";

import { listProjects } from "@/server/queries";

import { NewProjectForm } from "./NewProjectForm";

export const dynamic = "force-dynamic";

export default async function Home() {
    const projects = await listProjects();
    return (
        <div className="space-y-8">
            <h1 className="text-2xl font-semibold">Projects</h1>
            <NewProjectForm />
            <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
                {projects.map(p => (
                    <li key={p.id} className="flex justify-between px-4 py-3">
                        <Link href={`/projects/${p.id}`} className="font-medium underline-offset-2 hover:underline">
                            {p.name}
                        </Link>
                        <span className="text-sm text-zinc-500">
                            {p._count.runs} runs · {p._count.findings} findings
                        </span>
                    </li>
                ))}
                {!projects.length && <li className="px-4 py-3 text-zinc-500">No projects yet.</li>}
            </ul>
        </div>
    );
}

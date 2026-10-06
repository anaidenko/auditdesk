import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/server/db";

import { RunProgress } from "./RunProgress";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
    const { runId } = await params;
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { project: true } });
    if (!run) notFound();
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">
                Run of <Link href={`/projects/${run.projectId}`}>{run.project.name}</Link>
            </h1>
            <RunProgress runId={run.id} />
            <Link href={`/projects/${run.projectId}/findings`} className="underline">
                Review the findings
            </Link>
        </div>
    );
}

import Link from "next/link";

import { Icon, button } from "@/app/ui";
import { awaitingReview, reportRepositoryNames } from "@/server/report";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The report downloads, with the findings' hours and the run's cost stated only when Andrii ticks
 * them (cost: design § 8; hours: § 10). SARIF is one file per repository, since an upload goes to
 * one; the button's name and value carry it. What awaits review is named beside them: the exports
 * leave it out, and an empty file looks broken.
 */
export async function ReportExport({ projectId }: { projectId: string }) {
    const repositories = await reportRepositoryNames(projectId);
    const waiting = await awaitingReview(projectId);
    const parts = [
        ...(waiting.findings ? [count(waiting.findings, "finding")] : []),
        ...(waiting.questions ? [count(waiting.questions, "question")] : [])
    ];
    return (
        <div className="flex flex-col items-end gap-1.5">
            <form method="get" className="flex flex-wrap items-center gap-2">
                <label
                    className="flex items-center gap-1.5 text-xs text-zinc-600"
                    title="Each finding's hours and the totals, in the HTML, the PDF and the Issues CSV"
                >
                    <input type="checkbox" name="hours" value="1" className="size-4 rounded border-zinc-300 accent-indigo-600" />
                    Include the hours
                </label>
                <label
                    className="flex items-center gap-1.5 text-xs text-zinc-600"
                    title="What the model calls cost, in the HTML and the PDF"
                >
                    <input type="checkbox" name="cost" value="1" className="size-4 rounded border-zinc-300 accent-indigo-600" />
                    Include the AI cost
                </label>
                <button formAction={`/projects/${projectId}/report`} className={button.secondary}>
                    <Icon name="download" />
                    HTML report
                </button>
                <button formAction={`/projects/${projectId}/report/pdf`} className={button.secondary}>
                    <Icon name="download" />
                    PDF report
                </button>
                {repositories.map(name => (
                    <button
                        key={name}
                        formAction={`/projects/${projectId}/report/sarif`}
                        name="repository"
                        value={name}
                        className={button.secondary}
                        title={`${name}'s findings for code scanning and CI`}
                    >
                        <Icon name="download" />
                        {repositories.length > 1 ? `SARIF: ${name}` : "SARIF"}
                    </button>
                ))}
                <button
                    formAction={`/projects/${projectId}/report/issues`}
                    className={button.secondary}
                    title="Issue drafts for Linear's CSV import or another tracker's"
                >
                    <Icon name="download" />
                    Issues CSV
                </button>
                <a
                    href={`/projects/${projectId}/report/issues?format=json`}
                    className="text-xs text-indigo-700 hover:underline"
                    title="For pnpm issues:gh"
                >
                    Issues JSON
                </a>
            </form>
            {parts.length > 0 && (
                <p className="text-right text-xs text-amber-800">
                    <Link href={`/projects/${projectId}/findings?status=unreviewed`} className="font-medium underline hover:text-amber-900">
                        {parts.join(" and ")} {waiting.findings + waiting.questions === 1 ? "awaits" : "await"} review
                    </Link>
                    : the exports carry only the accepted and edited ones.
                </p>
            )}
        </div>
    );
}

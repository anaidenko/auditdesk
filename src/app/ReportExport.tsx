import { Icon, button } from "@/app/ui";
import { reportRepositoryNames } from "@/server/report";

/**
 * The report downloads, with the run's cost stated only when Andrii ticks it (design § 8). SARIF is
 * one file per repository, since an upload goes to one; the button's name and value carry it.
 */
export async function ReportExport({ projectId }: { projectId: string }) {
    const repositories = await reportRepositoryNames(projectId);
    return (
        <form method="get" className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                <input type="checkbox" name="cost" value="1" className="size-4 rounded border-zinc-300 accent-indigo-600" />
                Include the cost
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
    );
}

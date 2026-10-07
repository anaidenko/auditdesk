import { Icon, button } from "@/app/ui";

/** The report downloads, with the run's cost stated only when Andrii ticks it (design § 8). */
export function ReportExport({ projectId }: { projectId: string }) {
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
            <button formAction={`/projects/${projectId}/report/sarif`} className={button.secondary} title="For code-scanning tools and CI">
                <Icon name="download" />
                SARIF
            </button>
            <button
                formAction={`/projects/${projectId}/report/issues`}
                className={button.secondary}
                title="Issue drafts for a tracker's import"
            >
                <Icon name="download" />
                Issues CSV
            </button>
            <a
                href={`/projects/${projectId}/report/issues?format=json`}
                className="text-xs text-indigo-700 hover:underline"
                title="For pnpm issues:gh"
            >
                JSON
            </a>
        </form>
    );
}

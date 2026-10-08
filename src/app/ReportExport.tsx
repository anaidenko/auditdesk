import Link from "next/link";

import { Icon, button, label } from "@/app/ui";
import { awaitingReview, reportRepositoryNames } from "@/server/report";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function Option({ id, name, title, note }: { id: string; name: string; title: string; note: string }) {
    return (
        <div className="flex items-start gap-2.5">
            <input
                id={id}
                type="checkbox"
                name={name}
                value="1"
                aria-describedby={`${id}-note`}
                className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 accent-indigo-600"
            />
            <div className="text-sm">
                <label htmlFor={id} className="font-medium text-zinc-800">
                    {title}
                </label>
                <p id={`${id}-note`} className="text-xs text-zinc-500">
                    {note}
                </p>
            </div>
        </div>
    );
}

/**
 * The downloads behind one Export button, its options beside them (design § 8): the cost stated only
 * when Andrii ticks it; a draft with what awaits review, marked, for a first look before the review.
 * SARIF is one file per repository, since an upload goes to one; the button's name and value carry
 * it. The panel is a native popover: it closes on Escape or a click outside, with no script.
 */
export async function ReportExport({ projectId }: { projectId: string }) {
    const repositories = await reportRepositoryNames(projectId);
    const waiting = await awaitingReview(projectId);
    const parts = [
        ...(waiting.findings ? [count(waiting.findings, "finding")] : []),
        ...(waiting.questions ? [count(waiting.questions, "question")] : [])
    ];
    const panel = `export-${projectId}`;
    const download = (path: string) => `/projects/${projectId}/report${path}`;
    return (
        <form method="get">
            <button type="button" popoverTarget={panel} className={button.secondary}>
                <Icon name="download" />
                Export
                <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4 text-zinc-400">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
            <div
                id={panel}
                popover="auto"
                role="dialog"
                aria-labelledby={`${panel}-title`}
                className="popover-under-invoker w-[min(26rem,calc(100vw-2rem))] rounded-xl border-0 bg-white p-0 text-zinc-900 shadow-xl ring-1 ring-zinc-900/10"
            >
                <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
                    <h2 id={`${panel}-title`} className="text-sm font-semibold">
                        Export
                    </h2>
                    <button
                        type="button"
                        popoverTarget={panel}
                        popoverTargetAction="hide"
                        aria-label="Close"
                        className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                    >
                        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
                            <path d="M6 6l12 12 M18 6L6 18" />
                        </svg>
                    </button>
                </div>
                <div className="space-y-5 px-5 py-4">
                    {parts.length > 0 && (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20 ring-inset">
                            <Link href={`/projects/${projectId}/findings?status=unreviewed`} className="font-medium underline">
                                {parts.join(" and ")} {waiting.findings + waiting.questions === 1 ? "awaits" : "await"} review
                            </Link>
                            : the exports carry only the accepted and edited ones, unless the draft is ticked.
                        </p>
                    )}
                    <fieldset className="space-y-3">
                        <legend className={`${label} mb-2.5`}>Options</legend>
                        <Option
                            id={`${panel}-cost`}
                            name="cost"
                            title="Include the cost"
                            note="The model calls' cost, under Technical details."
                        />
                        {parts.length > 0 && (
                            <Option
                                id={`${panel}-draft`}
                                name="draft"
                                title="Draft: add what awaits review"
                                note="Marked “not reviewed” in the report, the PDF and the SARIF; the issues stay reviewed only."
                            />
                        )}
                    </fieldset>
                    <div>
                        <div className={label}>Report</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button formAction={download("")} className={button.secondary}>
                                <Icon name="download" />
                                HTML report
                            </button>
                            <button formAction={download("/pdf")} className={button.secondary}>
                                <Icon name="download" />
                                PDF report
                            </button>
                        </div>
                    </div>
                    <div>
                        <div className={label}>Code scanning and trackers</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            {repositories.map(name => (
                                <button
                                    key={name}
                                    formAction={download("/sarif")}
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
                                formAction={download("/issues")}
                                className={button.secondary}
                                title="Issue drafts for Linear's CSV import or another tracker's"
                            >
                                <Icon name="download" />
                                Issues CSV
                            </button>
                            <a
                                href={download("/issues?format=json")}
                                className="text-xs text-indigo-700 hover:underline"
                                title="For pnpm issues:gh"
                            >
                                Issues JSON
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    );
}

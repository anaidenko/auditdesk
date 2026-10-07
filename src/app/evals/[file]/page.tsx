import { notFound } from "next/navigation";

import { Badge, Card, PageHeader, button, input } from "@/app/ui";
import { parseEvalResult, parseVerdicts } from "@/engine/eval-results";
import { loadChecks, loadResultText } from "@/server/evals";

import { spotCheck } from "../actions";

export const dynamic = "force-dynamic";

/** Andrii's spot-check of the judge: each verdict on a finding outside the key, agreed with or not. */
export default async function SpotCheckPage({ params }: { params: Promise<{ file: string }> }) {
    const file = decodeURIComponent((await params).file);
    const md = await loadResultText(file).catch(() => null);
    const row = md ? parseEvalResult(md, file) : null;
    if (!md || !row) notFound();
    const verdicts = parseVerdicts(md);
    const checks = await loadChecks(file);
    const checked = verdicts.filter(v => checks[v.label]);
    return (
        <div className="space-y-8">
            <PageHeader eyebrow="Evals · spot-check" title={`${row.fixture}: ${row.model} at ${row.effort}`}>
                The judge read the findings the grader could not place. Agree or disagree with each verdict; your calls are kept beside the
                result. {checked.length} of {verdicts.length} checked, {checked.filter(v => checks[v.label].agree).length} agreed.
            </PageHeader>
            {verdicts.length === 0 && <p className="text-sm text-zinc-500">This run has no judge verdicts: it ran without --judge.</p>}
            {verdicts.map(v => {
                const check = checks[v.label];
                return (
                    <Card
                        key={v.label}
                        as="section"
                        title={`${v.label} · ${v.title}`}
                        description={`${v.item} · ${v.where}`}
                        actions={
                            <Badge tone={v.verdict === "false" ? "red" : v.verdict === "unsure" ? "zinc" : "emerald"}>{v.verdict}</Badge>
                        }
                    >
                        <p className="text-sm text-zinc-700">
                            {v.key && <span className="mr-1 font-mono text-xs">{v.key}</span>}
                            {v.reason}
                        </p>
                        <form action={spotCheck.bind(null, file, v.label)} className="mt-3 flex flex-wrap items-center gap-2">
                            <input
                                name="note"
                                defaultValue={check?.note ?? ""}
                                placeholder="Why (optional)"
                                className={`${input} max-w-md`}
                            />
                            <button name="agree" value="yes" className={button.secondary}>
                                Agree
                            </button>
                            <button name="agree" value="no" className={button.secondary}>
                                Disagree
                            </button>
                            {check && (
                                <span data-testid="spot-check" className="text-xs text-zinc-500">
                                    {check.agree ? "agreed" : "disagreed"} {check.at.slice(0, 10)}
                                </span>
                            )}
                        </form>
                    </Card>
                );
            })}
        </div>
    );
}

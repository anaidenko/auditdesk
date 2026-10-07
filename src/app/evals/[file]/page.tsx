import { notFound } from "next/navigation";

import { ActionForm } from "@/app/ActionForm";
import { Badge, Card, PageHeader, button, input } from "@/app/ui";
import { parseEvalResult, parseVerdicts } from "@/engine/eval-results";
import { type SpotCheck, currentCheck, loadChecks, loadResultText } from "@/server/evals";

import { spotCheck } from "../actions";

export const dynamic = "force-dynamic";

/** Andrii's spot-check of the judge: each verdict on a finding outside the key, agreed with or not. */
export default async function SpotCheckPage({ params }: { params: Promise<{ file: string }> }) {
    const file = decodeURIComponent((await params).file);
    const md = await loadResultText(file).catch(() => null);
    const row = md ? parseEvalResult(md, file) : null;
    if (!md || !row) notFound();
    const { verdicts, notJudged, unreadable } = parseVerdicts(md);
    let checks: Record<string, SpotCheck> = {};
    let broken: string | null = null;
    try {
        checks = await loadChecks(file);
    } catch (e) {
        broken = (e as Error).message;
    }
    const current = verdicts.map(v => currentCheck(checks, v));
    const checked = current.filter(Boolean);
    return (
        <div className="space-y-8">
            <PageHeader eyebrow="Evals · spot-check" title={`${row.fixture}: ${row.model} at ${row.effort}`}>
                The judge read the findings the grader could not place. Agree or disagree with each verdict; your calls are kept beside the
                result. {checked.length} of {verdicts.length} checked, {checked.filter(c => c!.agree).length} agreed.
            </PageHeader>
            {broken && <p className="text-sm text-red-700">{broken}</p>}
            {unreadable > 0 && (
                <p className="text-sm text-amber-800">
                    {unreadable} of the judge&apos;s verdicts could not be read from the result file, so they are not listed.
                </p>
            )}
            {verdicts.length === 0 && notJudged.length === 0 && (
                <p className="text-sm text-zinc-500">This run has no judge verdicts: it ran without --judge.</p>
            )}
            {verdicts.map((v, i) => {
                const check = current[i];
                const stale = !check && checks[v.label];
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
                        <ActionForm action={spotCheck.bind(null, file, v.label)} className="mt-3 flex flex-wrap items-center gap-2">
                            {/* The form's default button: Enter in the note submits nothing rather than "Agree". */}
                            <button type="submit" disabled hidden aria-hidden tabIndex={-1} />
                            <input
                                name="note"
                                defaultValue={check?.note ?? ""}
                                placeholder="Why (optional)"
                                aria-label={`Note on ${v.label}`}
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
                            {stale && (
                                <span data-testid="spot-check-stale" className="text-xs text-amber-800">
                                    checked when this label had another verdict; check it again
                                </span>
                            )}
                        </ActionForm>
                    </Card>
                );
            })}
            {notJudged.length > 0 && (
                <Card as="section" title="Not judged" description="The judge did not reach these, so there is nothing to agree with.">
                    <ul className="space-y-1 text-sm text-zinc-700">
                        {notJudged.map(v => (
                            <li key={v.label}>
                                <span className="font-mono text-xs">{v.label}</span> {v.title}: {v.reason}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}

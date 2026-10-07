import Link from "next/link";

import { Card, PageHeader } from "@/app/ui";
import type { EvalRow } from "@/engine/eval-results";
import { type EvalHistoryRow, evalResultsDir, loadEvalRows } from "@/server/evals";

export const dynamic = "force-dynamic";

const pct = (r: EvalRow) => (r.total ? Math.round((r.found / r.total) * 100) : 0);
const money = (x: number) => `$${x.toFixed(2)}`;
const cost = (usd: number, unpriced: boolean) => `${unpriced ? "≥ " : ""}${money(usd)}`;
const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);
const when = (r: EvalRow) => `${r.date.slice(0, 10)} ${r.date.slice(11, 16)}`;
const series = (r: EvalRow) => `${r.model} · ${r.effort}`;
const hollow = (r: EvalRow) => !!r.aborted || r.incomplete.length > 0;

function tone(model: string): { fill: string; stroke: string } {
    if (model.includes("opus")) return { fill: "fill-violet-500", stroke: "stroke-violet-500" };
    if (model.includes("haiku")) return { fill: "fill-amber-500", stroke: "stroke-amber-500" };
    return { fill: "fill-indigo-500", stroke: "stroke-indigo-500" };
}

/** Ticks of 1, 2 and 5 between `lo` and `hi`, only the powers of ten when that gives too many. */
function logTicks(lo: number, hi: number): number[] {
    const all = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].filter(t => t >= lo && t <= hi);
    return all.length > 6
        ? all.filter(t =>
              String(t)
                  .replace(/^0\.0*/, "")
                  .startsWith("1")
          )
        : all;
}

/**
 * Recall against the agents' cost on a log scale, since a fixture's runs span tens of times in
 * cost. Each point is numbered as its table row; one model at one effort is a series joined in
 * date order, so a re-run after a change reads as a step. A run that did not finish is hollow.
 */
function RecallChart({ rows }: { rows: { n: number; r: EvalRow }[] }) {
    const w = 640;
    const h = 260;
    const pad = { left: 44, right: 24, top: 14, bottom: 34 };
    const priced = rows.map(p => p.r.usd).filter(u => u > 0);
    const lo = priced.length ? Math.min(...priced) / 1.6 : 0.01;
    const hi = priced.length ? Math.max(...priced) * 1.6 : 1;
    const x = (usd: number) => pad.left + (Math.log(Math.max(usd, lo) / lo) / Math.log(hi / lo)) * (w - pad.left - pad.right);
    const y = (p: number) => h - pad.bottom - (p / 100) * (h - pad.top - pad.bottom);
    const points = rows.map(p => ({ ...p, cx: x(p.r.usd), cy: y(pct(p.r)) }));
    const placed: { x: number; y: number }[] = [];
    const labels = [...points]
        .sort((a, b) => a.cx - b.cx || a.cy - b.cy)
        .map(p => {
            const right = p.cx <= w / 2;
            const lx = p.cx + (right ? 8 : -8);
            let ly = p.cy + 4;
            while (placed.some(q => Math.abs(q.x - lx) < 16 && Math.abs(q.y - ly) < 11)) ly += 11;
            placed.push({ x: lx, y: ly });
            return { n: p.n, lx, ly, anchor: right ? ("start" as const) : ("end" as const) };
        });
    const lines = [...new Set(points.map(p => series(p.r)))]
        .map(s => points.filter(p => series(p.r) === s).sort((a, b) => a.r.date.localeCompare(b.r.date)))
        .filter(ps => ps.length > 1);
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full max-w-2xl" role="img" aria-label="Recall against cost">
            {[0, 25, 50, 75, 100].map(t => (
                <g key={t}>
                    <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} className="stroke-zinc-100" />
                    <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="fill-zinc-400 text-[10px]">
                        {t}%
                    </text>
                </g>
            ))}
            {logTicks(lo, hi).map(t => (
                <text key={t} x={x(t)} y={h - pad.bottom + 16} textAnchor="middle" className="fill-zinc-400 text-[10px]">
                    {t < 1 ? money(t) : `$${t}`}
                </text>
            ))}
            <text x={(w + pad.left) / 2} y={h - 4} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                agents&apos; cost, API-equivalent, log scale
            </text>
            {lines.map(ps => (
                <polyline
                    key={series(ps[0].r)}
                    points={ps.map(p => `${p.cx},${p.cy}`).join(" ")}
                    className={`${tone(ps[0].r.model).stroke} fill-none opacity-40`}
                />
            ))}
            {points.map(p => (
                <circle
                    key={p.r.file}
                    data-testid="eval-point"
                    data-hollow={hollow(p.r) || undefined}
                    cx={p.cx}
                    cy={p.cy}
                    r={5}
                    strokeWidth={2}
                    className={hollow(p.r) ? `fill-white ${tone(p.r.model).stroke}` : tone(p.r.model).fill}
                >
                    <title>
                        {`#${p.n} ${series(p.r)}, ${when(p.r)} UTC: ${p.r.found} of ${p.r.total}, ${cost(p.r.usd, p.r.unpriced)}` +
                            `${p.r.commit ? `, Auditdesk ${p.r.commit.slice(0, 7)}` : ""}` +
                            `${p.r.aborted ? `; aborted: ${p.r.aborted}` : ""}${p.r.incomplete.length ? `; ${p.r.incomplete.join(", ")}` : ""}`}
                    </title>
                </circle>
            ))}
            {labels.map(l => (
                <text key={l.n} x={l.lx} y={l.ly} textAnchor={l.anchor} className="fill-zinc-600 text-[10px] font-medium">
                    {l.n}
                </text>
            ))}
        </svg>
    );
}

/** The False column says which measure it shows: the judge's verdicts, or the grade's leftovers with those it left unresolved. */
function falseCell(r: EvalRow): string {
    if (r.falseFindings === null) return "–";
    if (r.falseByJudge) return `${r.falseFindings} judged`;
    return `${r.falseFindings}${r.beside ? ` (+${r.beside} beside, unjudged)` : ""}`;
}

/** The own fixture first, its score being the headline (design § 11); the most aspects first within one. */
function groups(rows: EvalHistoryRow[]): { fixture: string; aspects: string; rows: EvalHistoryRow[] }[] {
    const keys = [...new Set(rows.map(r => `${r.fixture}\n${r.aspects.join(", ")}`))].map(k => {
        const [fixture, aspects] = k.split("\n");
        return { fixture, aspects, rows: rows.filter(r => r.fixture === fixture && r.aspects.join(", ") === aspects) };
    });
    return keys.sort(
        (a, b) =>
            Number(b.fixture === "own") - Number(a.fixture === "own") ||
            a.fixture.localeCompare(b.fixture) ||
            b.rows[0].aspects.length - a.rows[0].aspects.length
    );
}

export default async function EvalsPage() {
    const { rows, skipped } = await loadEvalRows();
    return (
        <div className="space-y-8">
            <PageHeader eyebrow="Evals" title="Recall and cost by model and effort">
                Every `pnpm eval` result in evals/results: how many of a fixture&apos;s planted defects the run found, how many the agents
                found without the scanners, and what the agents cost.
            </PageHeader>
            {rows.length === 0 && (
                <p className="text-sm text-zinc-500">No eval results in {evalResultsDir()} yet. Run `pnpm eval` to write one.</p>
            )}
            {skipped.length > 0 && (
                <p className="text-sm text-amber-800" data-testid="eval-skipped">
                    {skipped.length} {skipped.length === 1 ? "file" : "files"} in the folder could not be read as a result:{" "}
                    {skipped.join(", ")}.
                </p>
            )}
            {groups(rows).map(g => {
                const numbered = g.rows.map((r, i) => ({ n: i + 1, r }));
                const keys = new Set(g.rows.map(r => r.keyDigest).filter(Boolean));
                return (
                    <Card
                        key={`${g.fixture} ${g.aspects}`}
                        as="section"
                        title={g.fixture}
                        description={`Aspects: ${g.aspects}. ${g.rows.length} ${g.rows.length === 1 ? "run" : "runs"}.`}
                    >
                        <>
                            <RecallChart rows={numbered} />
                            {keys.size > 1 && (
                                <p className="mt-2 text-xs text-amber-800">
                                    The key changed between these runs ({keys.size} digests): compare recall within one key.
                                </p>
                            )}
                            <p className="mt-2 text-xs text-zinc-500">
                                A hollow point did not finish: the audit was aborted, or an agent ended partial, failed or not started.
                            </p>
                            <table className="mt-4 w-full text-left text-sm">
                                <thead className="text-xs text-zinc-500 uppercase">
                                    <tr>
                                        <th className="py-2 font-medium">#</th>
                                        <th className="font-medium">Date, UTC</th>
                                        <th className="font-medium">Model · effort</th>
                                        <th className="font-medium">Recall</th>
                                        <th className="font-medium">Agents alone</th>
                                        <th className="font-medium">False</th>
                                        <th className="font-medium">Cost</th>
                                        <th className="font-medium">Time</th>
                                        <th className="font-medium">Key</th>
                                        <th className="font-medium">Auditdesk</th>
                                        <th className="font-medium">Judge</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 tabular-nums">
                                    {numbered.map(({ n, r }) => (
                                        <tr key={r.file} data-testid="eval-row" className="align-top">
                                            <td className="py-2 font-medium">{n}</td>
                                            <td className="whitespace-nowrap">{when(r)}</td>
                                            <td>
                                                {series(r)}
                                                {r.aborted && <div className="text-xs text-red-700">aborted: {r.aborted}</div>}
                                                {r.incomplete.length > 0 && (
                                                    <div className="text-xs text-amber-800">{r.incomplete.join(", ")}</div>
                                                )}
                                            </td>
                                            <td>
                                                {r.found} of {r.total} ({pct(r)}%)
                                            </td>
                                            <td>{r.agentsFound}</td>
                                            <td>{falseCell(r)}</td>
                                            <td>
                                                {cost(r.usd, r.unpriced)}
                                                {r.judgeUsd !== null && (
                                                    <span className="text-zinc-500"> + judge {cost(r.judgeUsd, r.judgeUnpriced)}</span>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap">{duration(r.durationSec)}</td>
                                            <td className="font-mono text-xs">{r.keyDigest?.slice(0, 6) ?? "–"}</td>
                                            <td className="font-mono text-xs">
                                                {r.commit?.slice(0, 7) ?? "–"}
                                                {r.dirty && <div className="font-sans text-zinc-500">with uncommitted changes</div>}
                                            </td>
                                            <td className="whitespace-nowrap">
                                                {r.judged ? (
                                                    <Link
                                                        href={`/evals/${encodeURIComponent(r.file)}`}
                                                        className="text-indigo-700 hover:underline"
                                                    >
                                                        {r.checked} of {r.judged} checked
                                                    </Link>
                                                ) : (
                                                    "–"
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    </Card>
                );
            })}
        </div>
    );
}

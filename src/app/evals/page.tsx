import Link from "next/link";

import { Card, PageHeader } from "@/app/ui";
import type { EvalRow } from "@/engine/eval-results";
import { loadEvalRows } from "@/server/evals";

export const dynamic = "force-dynamic";

const pct = (r: EvalRow) => (r.total ? Math.round((r.found / r.total) * 100) : 0);
const money = (x: number) => `$${x.toFixed(2)}`;
const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** Recall against the agents' cost, one point per result: which model and effort earn their price. */
function RecallChart({ rows }: { rows: EvalRow[] }) {
    const w = 640;
    const h = 260;
    const pad = { left: 44, right: 16, top: 12, bottom: 34 };
    const maxUsd = Math.max(0.1, ...rows.map(r => r.usd)) * 1.1;
    const x = (usd: number) => pad.left + (usd / maxUsd) * (w - pad.left - pad.right);
    const y = (p: number) => h - pad.bottom - (p / 100) * (h - pad.top - pad.bottom);
    const ticks = [0, 25, 50, 75, 100];
    const usdTicks = [0, maxUsd / 2, maxUsd];
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full max-w-2xl" role="img" aria-label="Recall against cost">
            {ticks.map(t => (
                <g key={t}>
                    <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} className="stroke-zinc-100" />
                    <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="fill-zinc-400 text-[10px]">
                        {t}%
                    </text>
                </g>
            ))}
            {usdTicks.map(t => (
                <text key={t} x={x(t)} y={h - pad.bottom + 16} textAnchor="middle" className="fill-zinc-400 text-[10px]">
                    {money(t)}
                </text>
            ))}
            <text x={(w + pad.left) / 2} y={h - 4} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                agents&apos; cost, API-equivalent
            </text>
            {rows.map(r => (
                <g key={r.file} data-testid="eval-point">
                    <circle cx={x(r.usd)} cy={y(pct(r))} r={5} className={r.model.includes("opus") ? "fill-violet-500" : "fill-indigo-500"}>
                        <title>{`${r.model} at ${r.effort}: ${r.found} of ${r.total}, ${money(r.usd)}`}</title>
                    </circle>
                    <text x={x(r.usd) + 8} y={y(pct(r)) + 4} className="fill-zinc-600 text-[10px]">
                        {r.model.replace("claude-", "")} {r.effort}
                    </text>
                </g>
            ))}
        </svg>
    );
}

export default async function EvalsPage() {
    const rows = await loadEvalRows();
    const fixtures = [...new Set(rows.map(r => r.fixture))];
    return (
        <div className="space-y-8">
            <PageHeader eyebrow="Evals" title="Recall and cost by model and effort">
                Every `pnpm eval` result in evals/results: how many of a fixture&apos;s planted defects the run found, how many the agents
                found without the scanners, and what the agents cost.
            </PageHeader>
            {rows.length === 0 && <p className="text-sm text-zinc-500">No eval results yet. Run `pnpm eval` to write one.</p>}
            {fixtures.map(fixture => {
                const own = rows.filter(r => r.fixture === fixture);
                return (
                    <Card key={fixture} as="section" title={fixture} description={`${own.length} ${own.length === 1 ? "run" : "runs"}`}>
                        <RecallChart rows={own} />
                        <table className="mt-4 w-full text-left text-sm">
                            <thead className="text-xs text-zinc-500 uppercase">
                                <tr>
                                    <th className="py-2 font-medium">Date</th>
                                    <th className="font-medium">Model · effort</th>
                                    <th className="font-medium">Aspects</th>
                                    <th className="font-medium">Recall</th>
                                    <th className="font-medium">Agents alone</th>
                                    <th className="font-medium">False</th>
                                    <th className="font-medium">Cost</th>
                                    <th className="font-medium">Time</th>
                                    <th className="font-medium">Auditdesk</th>
                                    <th className="font-medium">Judge</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 tabular-nums">
                                {own.map(r => (
                                    <tr key={r.file} data-testid="eval-row">
                                        <td className="py-2">{r.date.slice(0, 10)}</td>
                                        <td>
                                            {r.model} · {r.effort}
                                            {r.aborted && <span className="ml-2 text-xs text-red-700">aborted</span>}
                                        </td>
                                        <td>{r.aspects.join(", ")}</td>
                                        <td>
                                            {r.found} of {r.total} ({pct(r)}%)
                                        </td>
                                        <td>{r.agentsFound}</td>
                                        <td>{r.falseFindings ?? "–"}</td>
                                        <td>
                                            {money(r.usd)}
                                            {r.judgeUsd !== null && <span className="text-zinc-500"> + judge {money(r.judgeUsd)}</span>}
                                        </td>
                                        <td>{duration(r.durationSec)}</td>
                                        <td className="font-mono text-xs">
                                            {r.commit?.slice(0, 7) ?? "–"}
                                            {r.dirty && <span title="with uncommitted changes">*</span>}
                                        </td>
                                        <td>
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
                    </Card>
                );
            })}
        </div>
    );
}

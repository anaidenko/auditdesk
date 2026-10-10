import { Badge } from "@/app/ui";

import type { policyView } from "./ai-policy-view";

const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

/**
 * The client's own exclusions from AI tools, as last read (policyView): each source, its patterns
 * and the files it excludes. A run enforces the policy it reads from its own clone.
 */
export function AiPolicyPanel({ view, auditedSha }: { view: ReturnType<typeof policyView>; auditedSha: string | null }) {
    const policy = view?.policy ?? null;
    const day = view?.at.toISOString().slice(0, 10);
    const where =
        view?.from === "detection"
            ? `Read with the stack detection of ${day}, on a clone of the branch.`
            : `Read by the last run, on ${day}, at ${auditedSha?.slice(0, 10)}.`;
    return (
        <details className="group w-full" data-testid="ai-policy">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-indigo-700 [&::-webkit-details-marker]:hidden">
                Client&apos;s AI policy
                {!policy ? (
                    <Badge tone="slate">not read yet</Badge>
                ) : policy.everything ? (
                    <Badge tone="red">excludes every file</Badge>
                ) : policy.sources.length ? (
                    <Badge tone="amber">{files(policy.excludedFiles)} excluded</Badge>
                ) : (
                    <Badge tone="slate">none found</Badge>
                )}
                {view?.stale && <Badge tone="amber">your patterns changed: detect again</Badge>}
                {!!policy?.warnings.length && (
                    <Badge tone="amber">{policy.warnings.length === 1 ? "1 warning" : `${policy.warnings.length} warnings`}</Badge>
                )}
            </summary>
            <div className="mt-3 space-y-3 text-xs text-zinc-600">
                {!policy ? (
                    <p>
                        Detect the stack to read the repository&apos;s own AI exclusions: Claude Code&apos;s Read denies and other
                        tools&apos; ignore files.
                    </p>
                ) : (
                    <>
                        <p>{where}</p>
                        {policy.everything && (
                            <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800 ring-1 ring-red-200 ring-inset">
                                A run refuses this repository: no file is left to read
                                {policy.readsNothing ? ` (a bare Read deny at ${policy.readsNothing})` : ""}. Ask the client which files the
                                review may read.
                            </p>
                        )}
                        {policy.sources.length ? (
                            <ul className="space-y-2">
                                {policy.sources.map(s => (
                                    <li key={s.file}>
                                        <span className="font-mono text-zinc-800">{s.file}</span> · {s.tool}
                                        {s.intent && " · intent, not enforced by any tool"}
                                        {s.nested && " · nested, its tool reads only the root one"} ·{" "}
                                        {s.patterns.length === 1 ? "1 pattern" : `${s.patterns.length} patterns`} · {files(s.excludedFiles)}
                                        <ul className="mt-1 font-mono text-zinc-700">
                                            {s.patterns.map(p => (
                                                <li key={`${p.line}:${p.pattern}`}>
                                                    {p.pattern}
                                                    {p.note && <span className="font-sans text-zinc-500"> ({p.note})</span>}
                                                </li>
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>No AI exclusions in the repository, and none of the auditor&apos;s.</p>
                        )}
                        {policy.excluded.length > 0 && (
                            <p>
                                Excluded, {files(policy.excludedFiles)} of {policy.files}:{" "}
                                <span className="font-mono text-zinc-800">{policy.excluded.join(", ")}</span>
                            </p>
                        )}
                        {policy.warnings.map(w => (
                            <p key={w} className="text-amber-800">
                                {w}
                            </p>
                        ))}
                    </>
                )}
            </div>
        </details>
    );
}

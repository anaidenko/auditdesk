import { AUDITOR, type AiPolicySummary } from "@/engine/ai-policy";

type Reading = { policy: AiPolicySummary; at: Date } | null;

/** The auditor's patterns as the policy reader takes them: no blank line, no comment, no trailing space. */
const patternsOf = (text: string | null) =>
    (text ?? "")
        .split(/\r?\n/)
        .map(l => l.replace(/\s+$/, ""))
        .filter(l => l && !l.startsWith("#"));

/**
 * What the project page shows of a repository's policy: the newer of the stack detection's reading
 * and the last run's, stale when the auditor's patterns changed since it was read.
 */
export function policyView(o: {
    detected: Reading;
    audited: Reading;
    auditor: string | null;
}): { policy: AiPolicySummary; at: Date; from: "detection" | "run"; stale: boolean } | null {
    const pick =
        o.detected && (!o.audited || o.detected.at >= o.audited.at)
            ? { ...o.detected, from: "detection" as const }
            : o.audited && { ...o.audited, from: "run" as const };
    if (!pick) return null;
    const read = pick.policy.sources.find(s => s.file === AUDITOR)?.patterns.map(p => p.pattern) ?? [];
    return { ...pick, stale: JSON.stringify(read) !== JSON.stringify(patternsOf(o.auditor)) };
}

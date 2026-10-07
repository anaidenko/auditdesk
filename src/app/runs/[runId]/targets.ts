import { SEAMS } from "@/engine/aspects";

export interface RunTarget {
    repositoryId: string;
    aspect: string;
    status: string;
}

/**
 * The rows a run can re-run, each with its latest agent's status: one per repository and aspect, and
 * the seams pass once, under the repository its agent ran in (the first one when it never started),
 * and only for two or more repositories, since the pass skips a single one. A run interrupted before
 * its agents started has none, yet each row can be re-run (design § 9).
 */
export function runTargets(
    repositories: { id: string }[],
    aspects: string[],
    agents: { repositoryId: string; aspect: string; status: string }[]
): RunTarget[] {
    const latest = new Map(agents.map(a => [`${a.repositoryId}:${a.aspect}`, a.status]));
    const status = (repositoryId: string, aspect: string) => latest.get(`${repositoryId}:${aspect}`) ?? "not started";
    const rows = repositories.flatMap(r =>
        aspects.filter(a => a !== SEAMS).map(aspect => ({ repositoryId: r.id, aspect, status: status(r.id, aspect) }))
    );
    if (!aspects.includes(SEAMS) || repositories.length < 2) return rows;
    const seams = agents.findLast(a => a.aspect === SEAMS)?.repositoryId ?? repositories[0].id;
    return [...rows, { repositoryId: seams, aspect: SEAMS, status: status(seams, SEAMS) }];
}

/**
 * Fewer than half of the checklist's items examined or partly examined: a review the run page and
 * the report must not pass off as complete. An agent finishing this way is sent back once while
 * most of its share is left (agent/tools.ts).
 */
export function limitedReview(coverage: { status: string }[]): boolean {
    const looked = coverage.filter(c => c.status === "examined" || c.status === "partly").length;
    return coverage.length > 0 && looked * 2 < coverage.length;
}

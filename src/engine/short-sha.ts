/** A commit for people: seven characters, each part of a seams re-check's commits joined by "+". */
export function shortSha(sha: string): string {
    return sha
        .split("+")
        .map(s => s.slice(0, 7))
        .join("+");
}

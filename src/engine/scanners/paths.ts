/** What a non-production file is for: a scanner's result in one rarely reaches users. */
export type SampleRole = "test" | "fixture" | "seed" | "example";

// A rule that lowers a severity must fail toward the original rating: each word counts only where it
// means sample data, and a route is never sample data, whatever its folders are called.
const TEST_NAME = /[._-](test|spec|cy|e2e-spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|^test_[^/]*\.py$|_spec\.rb$|[a-z0-9]Test\.(php|java|kt|cs)$/;
const TEST_DIR = /^(tests?|__tests__|testing|test-utils|testdata|__snapshots__|e2e|cypress|playwright)$/i;
const ROUTE = (parts: string[], name: string) =>
    parts.some(p => /^(routes|api|pages)$/i.test(p)) || (parts.includes("app") && /^(page|route|layout)\.[cm]?[jt]sx?$/.test(name));
const SEED_NAME = /^seeds?\.[cm]?[jt]s$|^seeds?\.(sql|json|ya?ml)$/;
const SEED_DIR = /^(seeds?|seeders?)$/i;
const DATA_DIR = /^(db|database|prisma|data)$/i;
const EXAMPLE_NAME = /\.(example|sample)(\.|$)/;
const EXAMPLE_DIR = /^(examples?|samples?|demo)$/i;
const FIXTURE_DIR = /^(fixtures?|mocks?)$/i;

/** A repository root's or a workspace package root's folder: `examples/`, `packages/ui/examples/`. */
const atRoot = (parts: string[], i: number) => i === 0 || (i === 2 && /^(packages|apps|libs)$/.test(parts[0]));

/** The role a path's name or folders give it; null for application code. */
export function sampleRole(path: string): SampleRole | null {
    const parts = path.split("/");
    const name = parts.pop()!;
    if (TEST_NAME.test(name)) return "test";
    if (ROUTE(parts, name)) return null;
    if (parts.some(p => TEST_DIR.test(p))) return "test";
    if (parts.some(p => p === "__mocks__" || p === "__fixtures__")) return "fixture";
    if (parts.some((p, i) => FIXTURE_DIR.test(p) && atRoot(parts, i))) return "fixture";
    const underData = (i: number) => parts.slice(0, i).some(p => DATA_DIR.test(p));
    if (SEED_NAME.test(name) && underData(parts.length)) return "seed";
    if (parts.some((p, i) => SEED_DIR.test(p) && underData(i))) return "seed";
    if (EXAMPLE_NAME.test(name)) return "example";
    if (parts.some((p, i) => EXAMPLE_DIR.test(p) && atRoot(parts, i))) return "example";
    return null;
}

export const ROLE_WORDS: Record<SampleRole, string> = {
    test: "in a test file",
    fixture: "in a fixture file",
    seed: "in a seed file",
    example: "in an example file"
};

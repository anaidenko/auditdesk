/** What a non-production file is for: a scanner's result in one rarely reaches users. */
export type SampleRole = "test" | "fixture" | "seed" | "example";

const SEGMENT: [SampleRole, RegExp][] = [
    ["test", /^(test|tests|__tests__|spec|specs|e2e|cypress)$/],
    ["fixture", /^(fixtures?|__fixtures__|mocks?|__mocks__)$/],
    ["seed", /^(seeds?|seeders?)$/],
    ["example", /^(examples?|samples?|demo)$/]
];
const NAME: [SampleRole, RegExp][] = [
    ["test", /\.(test|spec|cy)\.[cm]?[jt]sx?$/],
    ["seed", /^seeds?\./],
    ["example", /\.(example|sample)(\.|$)/]
];

/** The role a path's folders or name give it, the first folder deciding; null for application code. */
export function sampleRole(path: string): SampleRole | null {
    const parts = path.split("/");
    const name = parts.pop()!;
    for (const part of parts) for (const [role, re] of SEGMENT) if (re.test(part)) return role;
    for (const [role, re] of NAME) if (re.test(name)) return role;
    return null;
}

export const ROLE_WORDS: Record<SampleRole, string> = {
    test: "in a test file",
    fixture: "in a fixture file",
    seed: "in a seed file",
    example: "in an example file"
};

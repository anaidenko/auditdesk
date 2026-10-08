const MIN_VALUE = 4;
// A line of a multi-line secret shorter than this is too generic to mask (`-----`, `}`).
const MIN_LINE = 8;

/** Replaces, by value, every secret gitleaks found, wherever text reaches the model or the report (design § 6). */
export class Masker {
    private readonly entries: { value: string; label: string }[];

    constructor(secrets: { value: string; rule: string }[]) {
        const byValue = new Map<string, string>();
        const add = (value: string, rule: string) => {
            if (value.length >= MIN_VALUE && !byValue.has(value)) byValue.set(value, `[secret masked: ${rule}]`);
        };
        for (const { value, rule } of secrets) {
            add(value, rule);
            if (/\r?\n/.test(value)) {
                for (const line of value.split(/\r?\n/)) if (line.trim().length >= MIN_LINE) add(line.trim(), rule);
            }
        }
        this.entries = [...byValue].map(([value, label]) => ({ value, label })).sort((a, b) => b.value.length - a.value.length);
    }

    get count(): number {
        return this.entries.length;
    }

    mask(text: string): string {
        let out = text;
        for (const { value, label } of this.entries) if (out.includes(value)) out = out.split(value).join(label);
        return out;
    }

    maskDeep<T>(value: T): T {
        if (typeof value === "string") return this.mask(value) as T;
        if (Array.isArray(value)) return value.map(v => this.maskDeep(v)) as T;
        if (value && typeof value === "object")
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.maskDeep(v)])) as T;
        return value;
    }
}

/**
 * The password of every URL in text the auditor wrote for the agents (the brief, a repository's
 * instructions, which ask for its database): gitleaks masks only what it finds in the code, and
 * design § 12 keeps credentials out of every prompt.
 */
export const maskUrlPasswords = (text: string) => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi, "$1:[password masked]@");

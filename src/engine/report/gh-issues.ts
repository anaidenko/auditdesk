import { parseArgs } from "node:util";
import { z } from "zod";

import { type IssueDraft, ghIssueCommands } from "./exports";

export interface GhResult {
    status: number | null;
    stdout: string | null;
    stderr: string | null;
    error?: Error;
}

export interface IssuesIo {
    gh(args: string[], stdin?: string): GhResult;
    read(file: string): string;
    out(line: string): void;
    err(line: string): void;
}

const USAGE = "pnpm issues:gh <drafts.json> --repo owner/name [--labels] [--create [--public]]";

const drafts = z.array(z.object({ title: z.string(), body: z.string(), labels: z.array(z.string()) }).passthrough());

const labelOf = (title: string) => /^F-\d+:/.exec(title)?.[0];

/**
 * `pnpm issues:gh`: the "Issues JSON" export as GitHub issues through the gh CLI. Without --create
 * it previews them. It reads the repository first: a public one needs --public, since the issues
 * publish the findings, and an issue whose label already heads one there is skipped, so a run that
 * stopped can be run again. Returns the exit code.
 */
export function runIssues(argv: string[], io: IssuesIo): number {
    let args;
    try {
        args = parseArgs({
            args: argv,
            allowPositionals: true,
            strict: true,
            options: {
                repo: { type: "string" },
                labels: { type: "boolean" },
                create: { type: "boolean" },
                public: { type: "boolean" },
                help: { type: "boolean", short: "h" }
            }
        });
    } catch (e) {
        io.err(`${(e as Error).message}\n${USAGE}`);
        return 2;
    }
    const { values: o, positionals } = args;
    if (o.help || positionals.length !== 1 || !o.repo) {
        io.err(USAGE);
        return 2;
    }
    let list: IssueDraft[];
    try {
        const parsed = drafts.safeParse(JSON.parse(io.read(positionals[0])));
        if (!parsed.success) throw new Error();
        list = parsed.data.map(d => ({ ...d, severity: null }));
    } catch {
        io.err(`${positionals[0]} is not a list of issue drafts: download "Issues JSON" from the report's exports.\n${USAGE}`);
        return 2;
    }
    let commands;
    try {
        commands = ghIssueCommands(list, o.repo, { labels: !!o.labels });
    } catch (e) {
        io.err(`${(e as Error).message}\n${USAGE}`);
        return 2;
    }

    const read = (a: string[]): string | null => {
        const r = io.gh(a);
        if (r.error) {
            io.err((r.error as NodeJS.ErrnoException).code === "ENOENT" ? "gh is not installed or not on PATH." : r.error.message);
            return null;
        }
        if (r.status !== 0) {
            io.err(`${o.repo}: ${(r.stderr ?? "").trim() || `gh exited with ${r.status}`}`);
            return null;
        }
        return r.stdout ?? "";
    };
    const view = read(["repo", "view", o.repo, "--json", "visibility,nameWithOwner"]);
    if (view === null) return 1;
    const visibility = String((JSON.parse(view) as { visibility?: string }).visibility ?? "unknown").toLowerCase();
    const listed = read(["issue", "list", "--repo", o.repo, "--state", "all", "--limit", "5000", "--json", "title"]);
    if (listed === null) return 1;
    const existing = new Set((JSON.parse(listed) as { title: string }[]).map(i => labelOf(i.title)).filter(Boolean));
    const todo = commands.filter((_, i) => !existing.has(labelOf(list[i].title)));
    const skipped = commands.length - todo.length;

    if (!o.create) {
        for (const d of list) {
            if (existing.has(labelOf(d.title))) {
                io.out(`${d.title} (exists, skipped)`);
                continue;
            }
            const head = d.body
                .split("\n")
                .filter(l => l.trim())
                .slice(0, 2);
            io.out([d.title, ...(o.labels ? [`labels: ${d.labels.join(", ")}`] : []), ...head].join("\n    "));
        }
        io.out(
            `\n${todo.length} ${todo.length === 1 ? "issue" : "issues"} would be created in ${o.repo} (${visibility})` +
                `${skipped ? `; ${skipped} already ${skipped === 1 ? "exists" : "exist"}` : ""}. Add --create to create them.`
        );
        return 0;
    }
    if (visibility !== "private" && !o.public) {
        io.err(`${o.repo} is ${visibility}: anyone could read these findings. Add --public if they are meant to be published.`);
        return 1;
    }
    let created = 0;
    for (const c of todo) {
        const r = io.gh(c.args, c.stdin);
        const title = c.args[c.args.indexOf("--title") + 1];
        if (r.error || r.status !== 0) {
            io.err(
                `Stopped at "${title}": ${(r.stderr ?? r.error?.message ?? "").trim()}. ${created} created. ` +
                    "Run it again: the issues that exist are skipped."
            );
            return 1;
        }
        created++;
        io.out((r.stdout ?? "").trim());
    }
    io.out(`${created} created in ${o.repo}${skipped ? `; ${skipped} already existed` : ""}.`);
    return 0;
}

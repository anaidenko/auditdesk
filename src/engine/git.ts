import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** A clone of a large repository over a slow link takes minutes, never this long. */
const GIT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Nothing may wait for a typed password: GIT_TERMINAL_PROMPT covers HTTPS, BatchMode covers an SSH
 * key passphrase, which ssh would otherwise ask for on /dev/tty and hang the run.
 */
export function gitEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
    return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes", GIT_LFS_SKIP_SMUDGE: "1" };
}

/**
 * The auditor's own git config reaches every repository git touches here, a client's included. Its
 * Git LFS filters (required, through a git-lfs that may be missing) would fail a checkout, or, with
 * git-lfs installed, download objects from the client's LFS server. No filter runs: an LFS file
 * stays the pointer file the client committed, which is data like the rest.
 */
const NO_LFS = ["-c", "filter.lfs.required=false", "-c", "filter.lfs.process=", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.clean="];

/** Runs git without a shell. Never prompts: a URL that needs credentials must have them in the keychain or agent. */
export async function git(args: string[], cwd?: string, o: { timeoutMs?: number } = {}): Promise<string> {
    const { stdout } = await exec("git", [...NO_LFS, ...args], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: gitEnv() as NodeJS.ProcessEnv,
        timeout: o.timeoutMs ?? GIT_TIMEOUT_MS
    });
    return stdout.trim();
}

/** What git said went wrong: its first fatal or error line, not the advice that follows it. */
export function gitSays(e: Error): string {
    const lines = e.message
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);
    const said = lines.find(l => /^(fatal|error):/.test(l)) ?? lines.at(-1) ?? e.message;
    return said.replace(/^(fatal|error):\s*/, "");
}

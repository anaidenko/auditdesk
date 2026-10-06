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
    return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes" };
}

/** Runs git without a shell. Never prompts: a URL that needs credentials must have them in the keychain or agent. */
export async function git(args: string[], cwd?: string): Promise<string> {
    const { stdout } = await exec("git", args, {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: gitEnv() as NodeJS.ProcessEnv,
        timeout: GIT_TIMEOUT_MS
    });
    return stdout.trim();
}

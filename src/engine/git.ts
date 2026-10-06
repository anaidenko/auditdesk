import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Runs git without a shell. Never prompts: a URL that needs credentials must have them in the keychain or agent. */
export async function git(args: string[], cwd?: string): Promise<string> {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return stdout.trim();
}

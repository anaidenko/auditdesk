import { execFile } from "node:child_process";

import type { Mount, ScannerRunner, ScannerTool } from "./types";

export const IMAGES: Record<ScannerTool, string> = {
    gitleaks: "ghcr.io/gitleaks/gitleaks:v8.30.1",
    osv: "ghcr.io/google/osv-scanner:v2.6.0",
    semgrep: "semgrep/semgrep:1.179.0"
};

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise(resolve => {
        execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
            const code =
                error && typeof (error as NodeJS.ErrnoException).code === "number"
                    ? Number((error as NodeJS.ErrnoException).code)
                    : error
                      ? 1
                      : 0;
            resolve({ stdout, stderr, exitCode: code });
        });
    });
}

export function dockerRunner(): ScannerRunner {
    return {
        async run(tool, args, mounts: Mount[]) {
            const volumes = mounts.flatMap(m => ["-v", `${m.host}:${m.container}:ro`]);
            // The clone belongs to the Mac user; git in the container would refuse it as "dubious ownership".
            const safeDir = ["-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=*"];
            const r = await exec("docker", [
                "run",
                "--rm",
                "--network",
                tool === "osv" ? "bridge" : "none",
                ...safeDir,
                ...volumes,
                IMAGES[tool],
                ...args
            ]);
            // 125-127 are Docker's own failures (daemon down, image or command missing), never the scanner's.
            if (r.exitCode >= 125 && r.exitCode <= 127)
                throw new Error(`docker run ${IMAGES[tool]} failed (exit ${r.exitCode}): ${r.stderr.slice(-2000)}`);
            return r;
        },
        async digest(tool) {
            const r = await exec("docker", ["image", "inspect", "--format", "{{index .RepoDigests 0}}", IMAGES[tool]]);
            return r.stdout.trim();
        }
    };
}

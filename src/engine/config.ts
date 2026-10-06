import { homedir } from "node:os";
import { join } from "node:path";

export function expandHome(p: string): string {
    return p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function workspaceDir(): string {
    return expandHome(process.env.WORKSPACE_DIR || "~/.auditdesk/workspace");
}

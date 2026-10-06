import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expandHome } from "./config";

/**
 * The share of the plan's 5-hour window a run may use without the auditor's permission: the rest
 * stays for his other work (Andrii, 2026-10-06).
 */
export const PLAN_RESERVE = 0.5;

/** The plan's 5-hour window as the CLI last reported it; utilization is a fraction, times in epoch seconds. */
export interface PlanUsage {
    utilization: number;
    resetsAt: number;
    seenAt: number;
}

export function planUsagePath(): string {
    return join(expandHome(process.env.AUDITDESK_HOME || "~/.auditdesk"), "plan-usage.json");
}

/** The last reading, or null when there is none or its window has reset since. */
export async function readPlanUsage(): Promise<PlanUsage | null> {
    const raw = await readFile(planUsagePath(), "utf8").catch(() => null);
    if (!raw) return null;
    const u = JSON.parse(raw) as PlanUsage;
    return u.resetsAt > Date.now() / 1000 ? u : null;
}

export async function recordPlanUsage(window: { utilization: number; resetsAt: number }): Promise<void> {
    const path = planUsagePath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...window, seenAt: Math.floor(Date.now() / 1000) }) + "\n", { mode: 0o600 });
    await rename(tmp, path);
}

export function overReserve(u: PlanUsage | null): boolean {
    return !!u && u.utilization > PLAN_RESERVE;
}

export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

export const clock = (epochSeconds: number) =>
    new Date(epochSeconds * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Why a Claude plan run may not start now, or null. */
export function reserveRefusal(u: PlanUsage | null, allowed: boolean): string | null {
    if (allowed || !u || !overReserve(u)) return null;
    return `The Claude plan's 5-hour usage is at ${percent(u.utilization)} (seen ${clock(u.seenAt)}), above the ${percent(PLAN_RESERVE)} reserve; it resets ${clock(u.resetsAt)}.`;
}

/** The run form's line about the plan's 5-hour window. */
export function planUsageLine(u: PlanUsage | null): string {
    return u
        ? `Claude plan, 5-hour usage: ${percent(u.utilization)} (seen ${clock(u.seenAt)}, resets ${clock(u.resetsAt)}).`
        : `Claude plan, 5-hour usage: not measured yet; a run stops after its first call if it is above ${percent(PLAN_RESERVE)}.`;
}

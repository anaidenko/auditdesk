import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_RESERVE, overReserve, planReserve, planUsageLine, readPlanUsage, recordPlanUsage, reserveRefusal } from "./plan-usage";

const now = () => Math.floor(Date.now() / 1000);

beforeEach(async () => vi.stubEnv("AUDITDESK_HOME", await mkdtemp(join(tmpdir(), "auditdesk-home-"))));
afterEach(() => vi.unstubAllEnvs());

describe("plan usage", () => {
    it("reads nothing before the first reading", async () => {
        await expect(readPlanUsage()).resolves.toBeNull();
    });

    it("reads back the last 5-hour reading", async () => {
        await recordPlanUsage({ utilization: 0.23, resetsAt: now() + 3600 });
        await recordPlanUsage({ utilization: 0.31, resetsAt: now() + 3600 });
        await expect(readPlanUsage()).resolves.toMatchObject({ utilization: 0.31 });
    });

    it("forgets a reading once its window has reset", async () => {
        await recordPlanUsage({ utilization: 0.9, resetsAt: now() - 1 });
        await expect(readPlanUsage()).resolves.toBeNull();
    });

    it("takes the reserve from AUDITDESK_PLAN_RESERVE for one command, half the window otherwise", () => {
        expect(planReserve(undefined)).toBe(0.5);
        expect(planReserve("")).toBe(0.5);
        expect(planReserve("0.8")).toBe(0.8);
        for (const bad of ["80", "0", "-0.2", "half"]) expect(() => planReserve(bad), bad).toThrow(/AUDITDESK_PLAN_RESERVE/);
    });

    it("keeps half the window in reserve: over it only above 50%", () => {
        expect(PLAN_RESERVE).toBe(0.5);
        expect(overReserve(null)).toBe(false);
        expect(overReserve({ utilization: 0.5, resetsAt: now() + 60, seenAt: now() })).toBe(false);
        expect(overReserve({ utilization: 0.51, resetsAt: now() + 60, seenAt: now() })).toBe(true);
    });

    it("refuses a start above the reserve without permission, naming the usage", () => {
        const high = { utilization: 0.62, resetsAt: now() + 3600, seenAt: now() };
        expect(reserveRefusal(high, false)).toMatch(/5-hour usage is at 62%.*above the 50% reserve/);
        expect(reserveRefusal(high, true)).toBeNull();
        expect(reserveRefusal({ ...high, utilization: 0.4 }, false)).toBeNull();
        expect(reserveRefusal(null, false)).toBeNull();
    });

    it("tells the run form the last reading, or that there is none yet", () => {
        expect(planUsageLine({ utilization: 0.23, resetsAt: now() + 3600, seenAt: now() })).toMatch(
            /^Claude plan, 5-hour usage: 23% \(seen /
        );
        expect(planUsageLine(null)).toMatch(/not measured yet; a run stops after its first call if it is above 50%/);
    });
});

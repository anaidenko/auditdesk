import { describe, expect, it } from "vitest";

import type { AiPolicySummary } from "@/engine/ai-policy";

import { policyView } from "./ai-policy-view";

const summary = (patterns: string[]): AiPolicySummary => ({
    sources: patterns.length
        ? [
              {
                  file: "the auditor's exclusions",
                  tool: "the auditor",
                  patterns: patterns.map((pattern, i) => ({ line: i + 1, pattern })),
                  excludedFiles: 1
              }
          ]
        : [],
    warnings: [],
    readsNothing: null,
    files: 3,
    excludedFiles: patterns.length ? 1 : 0,
    excluded: [],
    everything: false
});

describe("policyView", () => {
    it("shows the newer of the detection's reading and the last run's", () => {
        const detected = { policy: summary([]), at: new Date("2026-10-01") };
        const audited = { policy: summary(["a/"]), at: new Date("2026-10-02") };
        expect(policyView({ detected, audited, auditor: "a/" })).toMatchObject({ from: "run", policy: audited.policy, stale: false });
        expect(policyView({ detected: { ...detected, at: new Date("2026-10-03") }, audited, auditor: null })).toMatchObject({
            from: "detection",
            stale: false
        });
        expect(policyView({ detected: null, audited: null, auditor: null })).toBeNull();
    });

    it("is stale when the auditor's patterns changed since it was read", () => {
        const audited = { policy: summary(["a/"]), at: new Date("2026-10-02") };
        expect(policyView({ detected: null, audited, auditor: "# from the email\na/\n\nb/\n" })?.stale).toBe(true);
        expect(policyView({ detected: null, audited, auditor: "# note\na/  \n" })?.stale).toBe(false);
        expect(policyView({ detected: null, audited: { ...audited, policy: summary([]) }, auditor: "" })?.stale).toBe(false);
    });
});

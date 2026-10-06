import { afterEach, describe, expect, it } from "vitest";

import { clockTime } from "./clock";

const tz = process.env.TZ;
afterEach(() => {
    process.env.TZ = tz;
});

describe("clockTime", () => {
    it("shows an event's time in the viewer's time zone, not UTC", () => {
        process.env.TZ = "Europe/Athens";
        expect(clockTime("2026-10-06T12:23:48.000Z")).toBe("15:23:48");
    });
});

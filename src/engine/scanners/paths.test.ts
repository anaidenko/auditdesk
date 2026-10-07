import { describe, expect, it } from "vitest";

import { sampleRole } from "./paths";

describe("sampleRole", () => {
    it("names test, fixture, seed and example paths", () => {
        expect(sampleRole("test/api/login.test.ts")).toBe("test");
        expect(sampleRole("frontend/src/app/app.guard.spec.ts")).toBe("test");
        expect(sampleRole("src/__tests__/a.js")).toBe("test");
        expect(sampleRole("cypress/e2e/login.cy.ts")).toBe("test");
        expect(sampleRole("src/test/fixtures/scanners/gitleaks.json")).toBe("test");
        expect(sampleRole("fixtures/users.json")).toBe("fixture");
        expect(sampleRole("prisma/seed.ts")).toBe("seed");
        expect(sampleRole("db/seeds/users.sql")).toBe("seed");
        expect(sampleRole("examples/basic/.env.example")).toBe("example");
        expect(sampleRole(".env.example")).toBe("example");
    });

    it("names nothing for application code", () => {
        expect(sampleRole("src/config.js")).toBeNull();
        expect(sampleRole("lib/insecurity.ts")).toBeNull();
        expect(sampleRole("routes/testimonials.ts")).toBeNull();
        expect(sampleRole("src/latest.ts")).toBeNull();
    });
});

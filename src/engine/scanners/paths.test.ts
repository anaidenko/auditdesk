import { describe, expect, it } from "vitest";

import { sampleRole } from "./paths";

describe("sampleRole", () => {
    it("names test files and folders, in any case and language", () => {
        for (const path of [
            "test/api/login.test.ts",
            "frontend/src/app/app.guard.spec.ts",
            "src/__tests__/a.js",
            "cypress/e2e/login.cy.ts",
            "src/test/fixtures/scanners/gitleaks.json",
            "src/testing/helpers.ts",
            "test-utils/render.tsx",
            "pkg/testdata/a.json",
            "src/__snapshots__/a.snap",
            "playwright/login.ts",
            "Tests/Unit/UserTest.php",
            "src/app/login.e2e-spec.ts",
            "pkg/api_test.go",
            "src/test_api.py",
            "spec/models/user_spec.rb"
        ])
            expect(sampleRole(path), path).toBe("test");
    });

    it("names fixtures, seeds and examples only where those words mean sample data", () => {
        expect(sampleRole("fixtures/users.json")).toBe("fixture");
        expect(sampleRole("src/__mocks__/fs.ts")).toBe("fixture");
        expect(sampleRole("prisma/seed.ts")).toBe("seed");
        expect(sampleRole("db/seeds/users.sql")).toBe("seed");
        expect(sampleRole("examples/basic/.env.example")).toBe("example");
        expect(sampleRole("packages/ui/examples/button.tsx")).toBe("example");
        expect(sampleRole(".env.example")).toBe("example");
    });

    it("names nothing for application code, routes included, whatever their folders are called", () => {
        for (const path of [
            "src/config.js",
            "lib/insecurity.ts",
            "routes/testimonials.ts",
            "src/latest.ts",
            "app/test/page.tsx",
            "pages/api/test/[id].ts",
            "app/demo/page.tsx",
            "src/demo/credentials.ts",
            "routes/seed.ts",
            "src/server/seed.ts",
            "src/samples/lab.ts",
            "src/fixtures/schedule.ts",
            "src/seeds/catalog.ts",
            "spec/openapi.yaml",
            "src/util/mocks/payments.ts",
            "src/api/test/handler.ts"
        ])
            expect(sampleRole(path), path).toBeNull();
    });
});

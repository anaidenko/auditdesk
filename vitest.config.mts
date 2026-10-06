// @next/env is CommonJS: an .mts config gets only its default export.
import nextEnv from "@next/env";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

nextEnv.loadEnvConfig(process.cwd());

export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url))
        }
    },
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx", "evals/**/*.test.ts"],
        environment: "node",
        globalSetup: ["src/test/global-setup.ts"],
        env: {
            // Every worker's Prisma client points at the test database.
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            // No live credential, from a shell export or ~/.auditdesk, reaches a test.
            ANTHROPIC_API_KEY: "",
            CLAUDE_CODE_OAUTH_TOKEN: "",
            AUDITDESK_HOME: mkdtempSync(join(tmpdir(), "auditdesk-test-home-"))
        },
        // Tests share one test database; files run one after another.
        fileParallelism: false,
        testTimeout: 30_000,
        reporters: process.env.GITHUB_ACTIONS === "true" ? ["default", "github-actions"] : ["default"]
    }
});

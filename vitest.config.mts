import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx", "evals/**/*.test.ts"],
        environment: "node",
        globalSetup: ["src/test/global-setup.ts"],
        // Tests share one test database; files run one after another.
        fileParallelism: false,
        reporters: process.env.GITHUB_ACTIONS === "true" ? ["default", "github-actions"] : ["default"]
    }
});

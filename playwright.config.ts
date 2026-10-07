import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
    testDir: "e2e",
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    reporter: [["list"]],
    globalSetup: "./e2e/global-setup.ts",
    use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
    projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
    webServer: {
        // The database is prepared here, not in globalSetup: Playwright starts the web server first,
        // and the runner marks interrupted work in that database as soon as the server is up.
        command: `node e2e/prepare-db.mjs && pnpm build && pnpm next start -H 127.0.0.1 -p ${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
            DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://auditdesk:auditdesk@127.0.0.1:5433/auditdesk_e2e",
            AUDITDESK_DIST_DIR: ".next-e2e",
            AUDITDESK_REPLAY_MODEL: "e2e/fixtures/aspects-run.json",
            AUDITDESK_SCANNER_REPLAY: "src/test/fixtures/scanners",
            WORKSPACE_DIR: "/tmp/auditdesk-e2e-workspace",
            // Fake credentials, set here so the real ones in .env.local never load (@next/env keeps a defined variable).
            CLAUDE_CODE_OAUTH_TOKEN: "e2e-plan-token",
            ANTHROPIC_API_KEY: "",
            AUDITDESK_HOME: "/tmp/auditdesk-e2e-home",
            // A copy, made by prepare-db.mjs: the spot-check page writes beside the results.
            AUDITDESK_EVAL_RESULTS: "/tmp/auditdesk-e2e-evals"
        }
    }
});

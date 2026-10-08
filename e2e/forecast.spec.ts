import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// The end-to-end server's database and AUDITDESK_HOME (playwright.config.ts).
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://auditdesk:auditdesk@127.0.0.1:5433/auditdesk_e2e";
const E2E_HOME = "/tmp/auditdesk-e2e-home";
const samplePath = () => readFileSync("e2e/.sample-path", "utf8").trim();

/** A past Claude plan run whose reading moved 22 points for $10 between its first change and its last. */
async function pastPlanRun(db: pg.Client): Promise<string> {
    const project = await db.query<{ id: string }>(
        `INSERT INTO "Project" (id, name) VALUES (gen_random_uuid(), 'Past plan run') RETURNING id`
    );
    const run = await db.query<{ id: string }>(
        `INSERT INTO "Run" (id, "projectId", status, model, effort, "modelAccess", aspects, "budgetUsd", "budgetTokens")
         VALUES (gen_random_uuid(), $1, 'done', 'claude-opus-5-5', 'high', 'claude_plan', '{security}', 33, 400000) RETURNING id`,
        [project.rows[0].id]
    );
    const runId = run.rows[0].id;
    const t0 = Date.now() - 3_600_000;
    const at = (minute: number) => new Date(t0 + minute * 60_000);
    await db.query(`INSERT INTO "Job" (id, "runId", status, "startedAt", "finishedAt") VALUES (gen_random_uuid(), $1, 'done', $2, $3)`, [
        runId,
        at(0),
        at(40)
    ]);
    for (const [minute, utilization] of [
        [1, 0.07],
        [2, 0.08],
        [30, 0.3]
    ])
        await db.query(`INSERT INTO "PlanReading" ("runId", utilization, "createdAt") VALUES ($1, $2, $3)`, [
            runId,
            utilization,
            at(minute)
        ]);
    for (const [minute, usd] of [
        [3, 4],
        [30, 6]
    ])
        await db.query(
            `INSERT INTO "ApiCall" (id, "runId", "requestedModel", "servedModel", fallback, "inputTokens", "cacheWrite5mTokens", "cacheWrite1hTokens", "cacheReadTokens", "outputTokens", "costUsd", "createdAt")
             VALUES (gen_random_uuid(), $1, 'claude-opus-5-5', 'claude-opus-5-5', false, 1, 0, 0, 0, 1, $2, $3)`,
            [runId, usd, at(minute)]
        );
    return project.rows[0].id;
}

test("the run form forecasts the plan window's share, and offers the box when the run may stop at the reserve", async ({ page }) => {
    const db = new pg.Client({ connectionString: DATABASE_URL });
    await db.connect();
    const past = await pastPlanRun(db);
    const usage = join(E2E_HOME, "plan-usage.json");
    try {
        // At the reserve, not past it: the box comes from the forecast alone, whatever the estimate.
        const now = Math.floor(Date.now() / 1000);
        mkdirSync(E2E_HOME, { recursive: true });
        writeFileSync(usage, JSON.stringify({ utilization: 0.5, resetsAt: now + 3600, seenAt: now }));
        await page.goto("/");
        await page.getByLabel("Project name").fill("Forecast");
        await page.getByRole("button", { name: "New project" }).click();
        await page.getByLabel("Repository URL or path").fill(samplePath());
        await page.getByRole("button", { name: "Add repository" }).click();
        await expect(page.getByTestId("plan-share")).toContainText(
            /^About \d+(–\d+)?% of the plan's 5-hour window.* at \d+\.\d% per API-equivalent dollar from \d+ past runs?;/
        );
        await expect(
            page.getByText(/^At 50% when last read \(.+\), about \$0\.00 of API-equivalent fits under the 50% reserve/)
        ).toBeVisible();
        await expect(page.getByLabel("Allow past the 50% reserve")).toBeVisible();
    } finally {
        rmSync(usage, { force: true });
        await db.query(`DELETE FROM "Project" WHERE id = $1`, [past]);
        await db.end();
    }
});

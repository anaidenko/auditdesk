import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The README's screenshots, from a replayed run on the sample repository: no client data.
// Run with AUDITDESK_SCREENSHOTS=1 pnpm test:e2e -g screenshots.
test.skip(!process.env.AUDITDESK_SCREENSHOTS, "screenshots are taken on request");

const out = "docs/screenshots";

test("screenshots for the README", async ({ page }) => {
    mkdirSync(out, { recursive: true });
    const shot = (name: string) => page.screenshot({ path: join(out, `${name}.png`) });
    await page.goto("/");
    await page.getByLabel("Project name").fill("Acme shop");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Repository URL or path").fill(readFileSync("e2e/.sample-path", "utf8").trim());
    await page.getByRole("button", { name: "Add repository" }).click();
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const notes = page.locator("details", { hasText: "Stack and instructions" });
    await notes.locator("summary").click();
    await notes.getByRole("button", { name: "Detect stack" }).click();
    await expect(notes).toContainText("detected, not confirmed");
    await page.getByLabel("What the product does").fill("An online shop with customer accounts and a calculator API.");
    await page.getByRole("button", { name: "Save brief" }).click();
    await page.getByRole("checkbox", { name: "Code quality and tests" }).check();
    await shot("project");

    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    await shot("run");

    await page.getByRole("link", { name: "Review the findings" }).click();
    for (const title of ["User input reaches eval", "No tests for the server"]) {
        const f = page.locator("details", { hasText: title });
        await f.locator("summary").click();
        await f.getByRole("button", { name: "Accept" }).click();
        await expect(f).toContainText("accepted");
    }
    await page.locator("details", { hasText: "User input reaches eval" }).locator("summary").click();
    await shot("findings");

    const html = await (await page.request.get(page.url().replace(/\/findings.*$/, "/report"))).text();
    const file = join(tmpdir(), "auditdesk-sample-report.html");
    writeFileSync(file, html);
    await page.goto(`file://${file}`);
    await shot("report-cover");
    await page.locator('details[id^="F-"]').first().scrollIntoViewIfNeeded();
    await shot("report-finding");
});

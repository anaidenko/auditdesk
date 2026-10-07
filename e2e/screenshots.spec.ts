import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The README's screenshots, from a replayed run on the sample repository: no client data.
// Run with AUDITDESK_SCREENSHOTS=1 pnpm test:e2e -g screenshots.
test.skip(!process.env.AUDITDESK_SCREENSHOTS, "screenshots are taken on request");

// One clock and one repository path in every shot, so a retake changes only what changed.
test.use({ timezoneId: "UTC" });
const SAMPLE = "/tmp/acme-shop";
const out = "docs/screenshots";

test("screenshots for the README", async ({ page }) => {
    mkdirSync(out, { recursive: true });
    rmSync(SAMPLE, { recursive: true, force: true });
    execFileSync("git", ["clone", "-q", readFileSync("e2e/.sample-path", "utf8").trim(), SAMPLE]);
    const shot = (name: string) => page.screenshot({ path: join(out, `${name}.png`), animations: "disabled" });
    await page.goto("/");
    await page.getByLabel("Project name").fill("Acme shop");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Repository URL or path").fill(SAMPLE);
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
    // React leaves <details> open after Accept: each is closed again, then the one to show is opened.
    for (const title of ["User input reaches eval", "No tests for the server"]) {
        const f = page.locator("details", { hasText: title });
        await f.locator("summary").click();
        await f.getByRole("button", { name: "Accept" }).click();
        await expect(f).toContainText("accepted");
        await f.locator("summary").click();
        await expect(f).not.toHaveAttribute("open");
    }
    await page.locator("details", { hasText: "User input reaches eval" }).locator("summary").click();
    await shot("findings");

    const html = await (await page.request.get(page.url().replace(/\/findings.*$/, "/report"))).text();
    const file = join(tmpdir(), "auditdesk-sample-report.html");
    writeFileSync(file, html);
    await page.goto(`file://${file}`);
    // The first card open and the next one collapsed, so one image shows both states. A full-page
    // clip is in document coordinates, a bounding box in the viewport's: the click scrolls the page.
    const cards = page.locator("section#findings article.finding");
    await cards.first().locator(".body > summary").click();
    const scrolled = await page.evaluate(() => scrollY);
    const top = (await page.locator("section#findings").boundingBox())!;
    const last = (await cards.nth(Math.min(1, (await cards.count()) - 1)).boundingBox())!;
    await page.screenshot({
        path: join(out, "report-finding.png"),
        animations: "disabled",
        fullPage: true,
        clip: { x: 0, y: top.y + scrolled - 24, width: page.viewportSize()!.width, height: last.y + last.height - top.y + 48 }
    });
});

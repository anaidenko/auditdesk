import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";

const samplePath = () => readFileSync("e2e/.sample-path", "utf8").trim();

async function newProject(page: Page, name: string) {
    await page.goto("/");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Repository URL or path").fill(samplePath());
    await page.getByRole("button", { name: "Add repository" }).click();
    await expect(page.getByText(samplePath())).toBeVisible();
}

test("a run from project to downloaded report", async ({ page }) => {
    await newProject(page, "Sample");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    // Rendered by the server once the run ends, without a reload.
    await expect(page.getByRole("button", { name: "Re-run this aspect" })).toBeVisible();

    await page.getByRole("link", { name: "Review the findings" }).click();
    const evalFinding = page.locator("details", { hasText: "User input reaches eval" });
    await evalFinding.locator("summary").click();
    await evalFinding.getByRole("button", { name: "Accept" }).click();
    await expect(evalFinding).toContainText("accepted");

    const label = (await evalFinding.locator("summary").innerText()).match(/F-\d{3}/)![0];
    const report = await page.request.get(page.url().replace(/\/findings.*$/, "/report"));
    const html = await report.text();
    expect(html).toContain(`id="${label}"`);
    expect(html).not.toContain("Generic API Key"); // gitleaks' finding was not accepted, so it stays out
});

async function finishedRun(page: Page, name: string) {
    await newProject(page, name);
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
}

test("a re-run shows its progress without a reload", async ({ page }) => {
    await finishedRun(page, "Rerun");
    await page.getByRole("button", { name: "Re-run this aspect" }).click();
    await expect(page.getByText("Run done.")).toHaveCount(2, { timeout: 60_000 });
});

test("a review refusal is shown on the page, not as an error page", async ({ page }) => {
    await finishedRun(page, "Refusal");
    await page.getByRole("link", { name: "Review the findings" }).click();
    await page.locator("details").first().locator("summary").click();
    await page.getByRole("link", { name: "Edit or merge" }).first().click();
    await page.getByPlaceholder("F-012").fill("F-099");
    await page.getByRole("button", { name: "Merge" }).click();
    await expect(page.getByText("No finding F-099 in this project.")).toBeVisible();
});

test("starting twice queues one run", async ({ page }) => {
    await newProject(page, "Double");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save" }).click();
    const projectUrl = page.url();
    const start = page.getByRole("button", { name: "Start run" });
    // Two clicks before React re-renders: the pending state cannot stop the second one, the index must.
    await start.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
    });
    await page.waitForURL(/\/runs\//);
    // A fresh load: going back would show the router's cached page from before the run existed.
    await page.goto(projectUrl);
    await expect(page.locator("section", { hasText: "Runs" }).getByRole("listitem")).toHaveCount(1);
});

test("a run needs the client's AI consent", async ({ page }) => {
    await newProject(page, "No consent");
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByText("Record the client's AI consent first.")).toBeVisible();
});

test("a foreign Host header is refused", async () => {
    const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port: 3100, path: "/", headers: { Host: "evil.example" } }, res =>
            resolve(res.statusCode ?? 0)
        );
        req.on("error", reject);
        req.end();
    });
    expect(status).toBe(403);
});

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const samplePath = () => readFileSync("e2e/.sample-path", "utf8").trim();

test("a repository added without a branch takes its default one, and its branch changes in place", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Project name").fill("Branch");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Repository URL or path").fill(samplePath());
    await page.getByRole("button", { name: "Add repository" }).click();
    const branch = page.getByLabel("Branch to audit");
    await expect(branch).toHaveValue("main");

    await branch.fill("release/1.2");
    // The action posts in the background: a reload before its answer renders the branch it replaced.
    await Promise.all([
        page.waitForResponse(r => r.request().method() === "POST" && !!r.request().headers()["next-action"]),
        page.getByRole("button", { name: "Save branch" }).click()
    ]);
    await expect(page.getByText("Branch saved: the next run clones release/1.2.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Branch to audit")).toHaveValue("release/1.2");

    await page.getByLabel("Branch to audit").fill("-x");
    await page.getByRole("button", { name: "Save branch" }).click();
    await expect(page.getByText("Not a branch name: -x")).toBeVisible();
});

test("a source git cannot read is refused in git's own words, and a repository without findings can be removed", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Project name").fill("Sources");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Repository URL or path").fill("/nowhere/app");
    await page.getByRole("button", { name: "Add repository" }).click();
    await expect(page.getByText(/^Could not read \/nowhere\/app: .*does not appear to be a git repository/)).toBeVisible();
    await expect(page.getByLabel("Branch to audit")).toHaveCount(0);

    await page.getByLabel("Repository URL or path").fill(samplePath());
    await page.getByRole("button", { name: "Add repository" }).click();
    await expect(page.getByLabel("Branch to audit")).toHaveValue("main");
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByLabel("Branch to audit")).toHaveCount(0);
});

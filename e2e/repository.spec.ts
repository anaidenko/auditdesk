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
    await page.getByRole("button", { name: "Save branch" }).click();
    await page.reload();
    await expect(page.getByLabel("Branch to audit")).toHaveValue("release/1.2");

    await page.getByLabel("Branch to audit").fill("-x");
    await page.getByRole("button", { name: "Save branch" }).click();
    await expect(page.getByText("Not a branch name: -x")).toBeVisible();
});

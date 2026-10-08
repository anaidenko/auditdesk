import { type Page, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo } from "../src/test/git-repo";

// A screenshot per feature, from a replayed run, for reviewing a version by eye: no client data.
// Run with AUDITDESK_TOUR=<folder> pnpm test:e2e -g tour.
const out = process.env.AUDITDESK_TOUR ?? "";
test.skip(!out, "the tour is taken on request");
test.use({ timezoneId: "UTC" });

/** A repository cloned to a short, fixed path, so the shots read well and repeat. */
function at(path: string, source: string): string {
    rmSync(path, { recursive: true, force: true });
    execFileSync("git", ["clone", "-q", source, path]);
    return path;
}

async function project(page: Page, name: string, sources: string[]) {
    await page.goto("/");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "New project" }).click();
    for (const source of sources) {
        await page.getByLabel("Repository URL or path").fill(source);
        await page.getByRole("button", { name: "Add repository" }).click();
        await expect(page.getByText(source)).toBeVisible();
    }
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
}

test("tour of the features", async ({ page }) => {
    test.setTimeout(240_000);
    mkdirSync(out, { recursive: true });
    // The app's header is sticky: in a full-page or element shot it would cover the content.
    const unstick = () => page.addStyleTag({ content: "header { position: static !important; }" });
    const shot = async (name: string, o: { fullPage?: boolean } = {}) => {
        await unstick();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(out, `${name}.png`), animations: "disabled", ...o });
    };
    const part = async (name: string, selector: string) => {
        await unstick();
        await page
            .locator(selector)
            .first()
            .screenshot({ path: join(out, `${name}.png`), animations: "disabled" });
    };
    const shop = at("/tmp/acme-shop", readFileSync("e2e/.sample-path", "utf8").trim());

    // Several repositories, stack detection with its suggestions, the brief and the AI-built mode.
    const api = at(
        "/tmp/acme-api",
        await makeRepo({
            "package.json": JSON.stringify({
                name: "acme-api",
                dependencies: { "@anthropic-ai/sdk": "0.131.0", "@prisma/client": "7.10.0", "next": "16.3.8" }
            }),
            "prisma/schema.prisma": "model Order {\n  id      Int @id\n  storeId Int\n  total   Int\n}\n",
            "src/app/api/chat/route.ts": "import Anthropic from '@anthropic-ai/sdk'\nexport async function POST() {}\n"
        })
    );
    await project(page, "Acme platform", [shop, api]);
    for (const n of [0, 1]) {
        const notes = page.locator("details", { hasText: "Stack and instructions" }).nth(n);
        await notes.locator("summary").click();
        await notes.getByRole("button", { name: "Detect stack" }).click();
        await expect(notes).toContainText("detected, not confirmed");
    }
    await page.getByLabel("What the product does").fill("A multi-store shop platform with a support chatbot.");
    await page.getByLabel(/AI-built/).check();
    await page.getByRole("button", { name: "Save brief" }).click();
    await shot("02-stack-brief-suggestions", { fullPage: true });

    // Model and effort per run, and the estimate that warns when the cap is below it.
    await page.locator('select[name="model"]').selectOption("claude-opus-5-5");
    await page.locator('select[name="effort"]').selectOption("max");
    await page.getByLabel("Cap, USD").fill("0.5");
    await page.getByLabel("Cap, USD").blur();
    await part("03-model-effort-estimate", 'section:has(h2:text("Runs"))');

    // Aspects per run, a replayed run, its progress and spend per serving model.
    await project(page, "Acme shop", [shop]);
    await page.getByRole("checkbox", { name: "Code quality and tests" }).check();
    await part("01-aspects-run-form", 'section:has(h2:text("Runs"))');
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    await shot("04-run-progress", { fullPage: true });

    // Review: the aspect filter, a scanner's dependency card with its lock-file lines, sign-off.
    await page.getByRole("link", { name: "Review the findings" }).click();
    await page.waitForURL(/\/findings/);
    const findingsUrl = page.url();
    for (const title of ["User input reaches eval", "No tests for the server", "lodash 4.17.15", "Generic API Key"]) {
        const f = page.locator("details", { hasText: title }).first();
        await f.locator("summary").click();
        await f.getByRole("button", { name: "Accept" }).click();
        await expect(f).toContainText("accepted");
        await f.locator("summary").click();
    }
    const lodash = page.locator("details", { hasText: "lodash 4.17.15" }).first();
    await lodash.locator("summary").click();
    await unstick();
    await lodash.screenshot({ path: join(out, "06-scanner-lockfile-evidence.png"), animations: "disabled" });
    await lodash.locator("summary").click();
    await page.getByLabel("Aspect").selectOption("security");
    await page.getByRole("button", { name: "Filter" }).click();
    await shot("05-findings-aspect-filter", { fullPage: true });
    await page.goto(findingsUrl);
    const evalFinding = page.locator("details", { hasText: "User input reaches eval" }).first();
    await evalFinding.locator("summary").click();
    await evalFinding.getByRole("link", { name: "Edit or merge" }).click();
    await page.locator('select[name="signoff"]').selectOption("before");
    await shot("07-finding-edit-signoff", { fullPage: true });

    // The report: cover, summary with the hours, scope with the cost, a finding with its references, the filters.
    const base = findingsUrl.replace(/\/findings.*$/, "");
    const html = await (await page.request.get(`${base}/report?cost=1&hours=1`)).text();
    const file = join(out, "report.html");
    writeFileSync(file, html);
    writeFileSync(join(out, "report.pdf"), await (await page.request.get(`${base}/report/pdf?cost=1&hours=1`)).body());
    await page.goto(`file://${file}`);
    await shot("08-report-cover");
    await part("09-report-summary", "section#summary");
    await part("10-report-scope-and-cost", "section#scope");
    await page.evaluate(() => document.querySelectorAll(".finding > .body").forEach(d => d.setAttribute("open", "")));
    await part("11-report-finding-references", 'article[id^="F-"]');
    await page.locator('.filters select[name="sev"]').selectOption("critical");
    await part("12-report-filters", "section#findings");
});

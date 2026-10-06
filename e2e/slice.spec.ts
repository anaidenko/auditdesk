import { type Page, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    // A Claude plan run's cap is in API-equivalent dollars (plan, Decision for Andrii 4).
    await expect(page.getByText(/cap \$10\.00 API-equivalent/)).toBeVisible();
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
    const pdf = await page.request.get(page.url().replace(/\/findings.*$/, "/report/pdf"));
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    // New projects default to Claude plan: the main flow ran the SDK engine against the fake server.
    expect(html).toContain("through the Claude Agent SDK");
});

test("a run over two aspects files findings under both, and the report covers both", async ({ page }) => {
    await newProject(page, "Two aspects");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Security" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Security" })).toBeDisabled();
    await page.getByRole("checkbox", { name: "Code quality and tests" }).check();
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 90_000 });

    await page.getByRole("link", { name: "Review the findings" }).click();
    for (const title of ["User input reaches eval", "No tests for the server"]) {
        const finding = page.locator("details", { hasText: title });
        await finding.locator("summary").click();
        await finding.getByRole("button", { name: "Accept" }).click();
        await expect(finding).toContainText("accepted");
    }
    const html = await (await page.request.get(page.url().replace(/\/findings.*$/, "/report"))).text();
    expect(html).toContain("Code quality and tests (");
    expect(html).toContain("QUA-02");
    expect(html).toContain("No tests for the server");

    // The next run's form starts from this run's aspects.
    await page.goto(page.url().replace(/\/findings.*$/, ""));
    await expect(page.getByRole("checkbox", { name: "Code quality and tests" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Architecture and structure" })).not.toBeChecked();
});

test("a refused start keeps the aspects and caps Andrii chose", async ({ page }) => {
    await newProject(page, "Refused start");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("checkbox", { name: "Data model and database" }).check();
    await page.getByLabel("Cap, USD").fill("3");
    await page.getByLabel("Cap, thousand tokens").fill("30");
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByText(/20 thousand/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Data model and database" })).toBeChecked();
    await expect(page.getByLabel("Cap, USD")).toHaveValue("3");
    await expect(page.getByLabel("Cap, thousand tokens")).toHaveValue("30");
});

test("the stack is detected and confirmed, and the brief is saved", async ({ page }) => {
    await newProject(page, "Stack and brief");
    const notes = page.locator("details", { hasText: "Stack and instructions" });
    await expect(notes).toContainText("not detected yet");
    await notes.locator("summary").click();
    await notes.getByRole("button", { name: "Detect stack" }).click();
    await expect(notes.getByLabel("Stack profile")).toHaveValue(/Frameworks: Express/);
    await expect(notes).toContainText("detected, not confirmed");
    await notes.getByLabel("How to run it").fill("npm start, port 3000");
    await notes.getByRole("button", { name: "Save the instructions only" }).click();
    await expect(notes).toContainText("detected, not confirmed");
    await notes.getByLabel("Stack profile").fill("Express 4 on Node.js; PostgreSQL through pg.");
    await notes.getByRole("button", { name: "Save and confirm the profile" }).click();
    await expect(notes.locator("summary")).toContainText(/confirmed \d{4}-\d{2}-\d{2}/);
    await expect(notes.getByLabel("How to run it")).toHaveValue("npm start, port 3000");

    // A detection that differs from the confirmed profile is shown beside it, one click from use.
    await notes.getByRole("button", { name: "Detect stack" }).click();
    await expect(notes.locator("summary")).toContainText("detection changed");
    await notes.getByRole("button", { name: "Use this detection" }).click();
    await expect(notes.getByLabel("Stack profile")).toHaveValue(/Frameworks: Express/);
    await expect(notes.locator("summary")).not.toContainText("detection changed");
    await notes.getByLabel("Stack profile").fill("Express 4 on Node.js; PostgreSQL through pg.");
    await notes.getByRole("button", { name: "Save and confirm the profile" }).click();

    const brief = page.locator("section", { hasText: "Brief" }).filter({ has: page.getByLabel("What the product does") });
    await brief.getByLabel("What the product does").fill("A calculator API for schools.");
    await brief.getByLabel(/AI-built/).check();
    await brief.getByRole("button", { name: "Save brief" }).click();
    await page.reload();
    await expect(page.getByLabel("What the product does")).toHaveValue("A calculator API for schools.");
    await expect(page.getByLabel(/AI-built/)).toBeChecked();
    await expect(page.getByLabel("Stack profile")).toHaveValue("Express 4 on Node.js; PostgreSQL through pg.");
});

test("an API key saved in Settings runs an audit, and no page shows the key", async ({ page }) => {
    const key = "sk-ant-e2e-0000000000000000wxyz";
    await page.goto("/settings");
    await page.getByLabel("API key value").fill(key);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("status-api_key")).toHaveText("saved · …wxyz");
    expect(await page.content()).not.toContain(key);

    await newProject(page, "On a key");
    await page.getByLabel("API key", { exact: true }).check();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("credential-status")).toHaveText("API key: saved · …wxyz");
    expect(await page.content()).not.toContain(key);
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
});

test("the model access tooltip says what was approved", async ({ page }) => {
    await newProject(page, "Tooltip");
    await page.getByLabel("About model access").click();
    await expect(page.getByRole("tooltip")).toContainText("Choose the API key when a client's NDA requires commercial terms");
});

async function finishedRun(page: Page, name: string) {
    await newProject(page, name);
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
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

test("a high finding marked to wait moves to Can wait in the report's summary", async ({ page }) => {
    await finishedRun(page, "Sign-off");
    await page.getByRole("link", { name: "Review the findings" }).click();
    const evalFinding = page.locator("details", { hasText: "User input reaches eval" });
    await evalFinding.locator("summary").click();
    const label = (await evalFinding.locator("summary").innerText()).match(/F-\d{3}/)![0];
    await evalFinding.getByRole("link", { name: "Edit or merge" }).click();
    await page.getByLabel("Sign-off").selectOption("later");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
    const html = await (await page.request.get(page.url().replace(/\/findings.*$/, "/report"))).text();
    const summary = html.slice(html.indexOf('<section id="summary">'), html.indexOf('<section id="scope">'));
    const wait = summary.slice(summary.indexOf("<h3>Can wait"));
    expect(wait).toContain(`href="#${label}"`);
    expect(summary.slice(0, summary.indexOf("<h3>Can wait"))).not.toContain(`href="#${label}"`);
});

test("opened from disk with the network off, the report's severity filter hides findings below it", async ({ page, context }) => {
    await finishedRun(page, "Offline report");
    await page.getByRole("link", { name: "Review the findings" }).click();
    for (const title of ["User input reaches eval", "Generic API Key"]) {
        const finding = page.locator("details", { hasText: title }).first();
        await finding.locator("summary").click();
        await finding.getByRole("button", { name: "Accept" }).click();
        await expect(finding).toContainText("accepted");
    }
    const html = await (await page.request.get(page.url().replace(/\/findings.*$/, "/report"))).text();
    const file = join(mkdtempSync(join(tmpdir(), "report-")), "report.html");
    writeFileSync(file, html);
    const requests: string[] = [];
    await context.route(/^https?:/, route => {
        requests.push(route.request().url());
        return route.abort();
    });
    await page.goto(`file://${file}`);
    await expect(page.locator(".filters output")).toHaveText("2 of 2 findings shown");
    await page.locator('.filters select[name="sev"]').selectOption("critical");
    await expect(page.locator(".filters output")).toHaveText("1 of 2 findings shown");
    await expect(page.locator("details.finding", { hasText: "User input reaches eval" })).toBeHidden();
    await expect(page.locator("details.finding", { hasText: "Generic API Key" })).toBeVisible();
    expect(requests).toEqual([]);
});

test("a run uses the model and effort chosen in the form", async ({ page }) => {
    await newProject(page, "Opus run");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator('select[name="model"]').selectOption("claude-opus-5-5");
    await page.locator('select[name="effort"]').selectOption("high");
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    await expect(page.getByText(/claude-opus-5-5 · effort high/)).toBeVisible();
});

test("the run form estimates the cost for the agents it would start", async ({ page }) => {
    await newProject(page, "Estimate");
    await expect(page.getByTestId("estimate")).toContainText("for 1 agent,");
    await page.getByRole("checkbox", { name: "Data model and database" }).check();
    await expect(page.getByTestId("estimate")).toContainText("for 2 agents,");
});

test("the run shows its spend per serving model, and the report states the cost only when asked", async ({ page }) => {
    await finishedRun(page, "Cost");
    await expect(page.getByTestId("served-by").first()).toContainText("claude-sonnet-5-5 · 4 calls");
    await page.getByRole("link", { name: "Review the findings" }).click();
    const accepted = page.locator("details", { hasText: "User input reaches eval" });
    await accepted.locator("summary").click();
    await accepted.getByRole("button", { name: "Accept" }).click();
    await expect(accepted).toContainText("accepted");
    const text = async (withCost: boolean) => {
        if (withCost) await page.getByLabel("Include the cost").check();
        else await page.getByLabel("Include the cost").uncheck();
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "HTML report" }).click()]);
        return readFileSync((await download.path())!, "utf8");
    };
    expect(await text(false)).not.toMatch(/cost of the model calls/i);
    expect(await text(true)).toMatch(/API-equivalent cost of the model calls: \$\d+\.\d{2}; the Claude plan bills nothing/);
});

test("starting twice queues one run", async ({ page }) => {
    await newProject(page, "Double");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
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

// AUDITDESK_HOME of the end-to-end server (playwright.config.ts), where the engine saves the plan's usage.
const E2E_HOME = "/tmp/auditdesk-e2e-home";

test("a Claude plan run above half of the 5-hour window starts only when allowed", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    const usage = join(E2E_HOME, "plan-usage.json");
    mkdirSync(E2E_HOME, { recursive: true });
    writeFileSync(usage, JSON.stringify({ utilization: 0.62, resetsAt: now + 3600, seenAt: now }));
    try {
        await newProject(page, "Reserve");
        await page.getByLabel(/client agreed/).check();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByTestId("plan-usage")).toContainText("62%");
        await page.getByRole("button", { name: "Start run" }).click();
        await expect(page.getByText(/above the 50% reserve/)).toBeVisible();
        await page.getByLabel("Allow past the 50% reserve").check();
        await page.getByRole("button", { name: "Start run" }).click();
        await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    } finally {
        rmSync(usage, { force: true });
    }
});

// The review's Minor 4: a page rendered before the reading crossed 50% has no checkbox, yet the refusal names it.
test("a run form rendered below the reserve offers the checkbox when the start is refused", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    const usage = join(E2E_HOME, "plan-usage.json");
    try {
        await newProject(page, "Stale reserve");
        await page.getByLabel(/client agreed/).check();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByTestId("plan-usage")).toContainText("not measured yet");
        mkdirSync(E2E_HOME, { recursive: true });
        writeFileSync(usage, JSON.stringify({ utilization: 0.58, resetsAt: now + 3600, seenAt: now }));
        await page.getByRole("button", { name: "Start run" }).click();
        await expect(page.getByText(/above the 50% reserve/)).toBeVisible();
        await page.getByLabel("Allow past the 50% reserve").check();
        await page.getByRole("button", { name: "Start run" }).click();
        await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    } finally {
        rmSync(usage, { force: true });
    }
});

import { type Page, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const samplePath = () => readFileSync("e2e/.sample-path", "utf8").trim();

async function newProject(page: Page, name: string, source = samplePath()) {
    await page.goto("/");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Repository URL or path").fill(source);
    await page.getByRole("button", { name: "Add repository" }).click();
    await expect(page.getByText(source)).toBeVisible();
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
    // Until Andrii reviews them, the exports leave the findings out, and the export panel says so.
    const exports = page.getByRole("dialog", { name: "Export" });
    await expect(exports).toBeHidden();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const waiting = exports.getByRole("link", { name: /^\d+ findings? (and \d+ questions? )?awaits? review$/ });
    await expect(waiting).toHaveAttribute("href", /\/findings\?status=unreviewed$/);
    const before = Number((await waiting.innerText()).match(/^\d+/)![0]);
    // A draft carries them for a first look, each marked; the issues stay reviewed only.
    await exports.getByLabel(/^Draft/).check();
    const [draft] = await Promise.all([page.waitForEvent("download"), exports.getByRole("button", { name: "HTML report" }).click()]);
    expect(draft.suggestedFilename()).toMatch(/^auditdesk-sample-draft-\d{4}-\d{2}-\d{2}\.html$/);
    const draftHtml = readFileSync(await draft.path(), "utf8");
    expect(draftHtml).toContain("User input reaches eval");
    expect(draftHtml).toContain('<span class="pill unreviewed">not reviewed</span>');
    await exports.getByLabel(/^Draft/).uncheck();
    await page.keyboard.press("Escape");
    await expect(exports).toBeHidden();
    const evalFinding = page.locator("details", { hasText: "User input reaches eval" });
    await evalFinding.locator("summary").click();
    await evalFinding.getByRole("button", { name: "Accept" }).click();
    await expect(evalFinding).toContainText("accepted");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(waiting).toHaveText(new RegExp(`^${before - 1} finding`));

    const label = (await evalFinding.locator("summary").innerText()).match(/F-\d{3}/)![0];
    const report = await page.request.get(page.url().replace(/\/findings.*$/, "/report"));
    const html = await report.text();
    expect(html).toContain(`id="${label}"`);
    expect(html).not.toContain("Generic API Key"); // gitleaks' finding was not accepted, so it stays out
    const pdf = await page.request.get(page.url().replace(/\/findings.*$/, "/report/pdf"));
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    const [sarif] = await Promise.all([page.waitForEvent("download"), exports.getByRole("button", { name: "SARIF" }).click()]);
    expect(sarif.suggestedFilename()).toMatch(/^auditdesk-sample-.+-\d{4}-\d{2}-\d{2}\.sarif$/);
    const log = JSON.parse(readFileSync(await sarif.path(), "utf8"));
    expect(log.runs[0].results.map((r: { properties: { label: string } }) => r.properties.label)).toEqual([label]);
    // New projects default to Claude plan: the main flow ran the SDK engine against the fake server.
    expect(html).toContain("through the Claude Agent SDK");
});

test("a re-audit on the client's new commit marks a changed finding, and the report lists it once Andrii verifies the fix", async ({
    page
}) => {
    // A clone of its own: the client's fix must not reach the sample the other tests audit.
    const repo = join(mkdtempSync(join(tmpdir(), "reaudit-")), "sample");
    execFileSync("git", ["clone", "-q", samplePath(), repo]);
    await newProject(page, "Re-audit", repo);
    const projectUrl = page.url();
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    await page.getByRole("link", { name: "Review the findings" }).click();
    const evalFinding = page.locator("details", { hasText: "User input reaches eval" });
    await evalFinding.locator("summary").click();
    await evalFinding.getByRole("button", { name: "Accept" }).click();
    await expect(evalFinding).toContainText("accepted");

    const server = join(repo, "src/server.js");
    writeFileSync(server, readFileSync(server, "utf8").replace("String(eval(req.query.expr))", "String(calc(req.query.expr))"));
    execFileSync("git", [
        "-C",
        repo,
        "-c",
        "user.name=Client",
        "-c",
        "user.email=client@example.com",
        "commit",
        "-qam",
        "Fix the calculator"
    ]);
    await page.goto(projectUrl);
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    await expect(page.getByText(/Re-checked \d+ earlier findings? against [0-9a-f]{7}: .*changed, to verify/)).toBeVisible();

    await page.getByRole("link", { name: "Review the findings" }).click();
    const earlier = page
        .locator("details")
        .filter({ has: page.getByTestId("recheck") })
        .filter({ hasText: "User input reaches eval" });
    await expect(earlier.getByTestId("recheck")).toContainText("code changed, verify");
    await earlier.locator("summary").click();
    await earlier.getByRole("button", { name: "Verified fixed" }).click();
    await expect(earlier.getByTestId("recheck")).toContainText("fixed");
    const html = await (await page.request.get(page.url().replace(/\/findings.*$/, "/report"))).text();
    const since = html.slice(html.indexOf('<section id="since">'), html.indexOf("</section>", html.indexOf('<section id="since">')));
    expect(since).toContain("1 fixed");
    expect(since).toContain("User input reaches eval");
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

test("an agent that finishes having looked at little is sent back once, then labelled a limited review", async ({ page }) => {
    await newProject(page, "Limited");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("checkbox", { name: "Production readiness" }).check();
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
    const production = page.getByRole("listitem").filter({ hasText: "Production readiness" }).first();
    await expect(production.getByTestId("limited-review")).toBeVisible();
    await expect(production).toContainText("Sent back once");
    await expect(page.getByText(/Production readiness: sent back to \d+ unexamined items of \d+\./)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Security" }).first().getByTestId("limited-review")).toHaveCount(0);
});

test("the Evals page plots recall against cost for every result of a fixture", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Evals" }).click();
    const juice = page.locator("section", { hasText: "Aspects: security. 2 runs." });
    await expect(juice.getByTestId("eval-row")).toHaveCount(2);
    await expect(juice.getByTestId("eval-row").first()).toContainText("claude-sonnet-5-5 · high");
    await expect(juice.getByTestId("eval-row").first()).toContainText("9 of 18 (50%)");
    await expect(juice.getByTestId("eval-point")).toHaveCount(2);
    // A run with a cut-short agent gets its own chart for its aspects, and a hollow point.
    const full = page.locator("section", { hasText: "Aspects: security, llm." });
    await expect(full.getByTestId("eval-row")).toContainText("llm: partial");
    await expect(full.getByTestId("eval-row")).toContainText("with uncommitted changes");
    await expect(full.locator("[data-testid=eval-point][data-hollow]")).toHaveCount(1);
    await expect(page.getByTestId("eval-skipped")).toHaveText("1 file in the folder could not be read as a result: notes.md.");
});

test("the judge's verdicts are spot-checked from the Evals page", async ({ page }) => {
    await page.goto("/evals");
    const own = page.locator("section", { hasText: "own" }).filter({ has: page.getByTestId("eval-row") });
    await own.getByRole("link", { name: "0 of 2 checked, 0 agreed" }).click();
    // Enter in a note records nothing: a disagreement is when a note gets written.
    const other = page.locator("section", { hasText: "F-009" });
    await other.getByPlaceholder("Why (optional)").fill("The judge is wrong here");
    await other.getByPlaceholder("Why (optional)").press("Enter");
    const verdict = page.locator("section", { hasText: "F-004" });
    await verdict.getByPlaceholder("Why (optional)").fill("The query is built from a constant.");
    await verdict.getByRole("button", { name: "Agree", exact: true }).click();
    await expect(verdict.getByTestId("spot-check")).toContainText("agreed");
    await expect(other.getByTestId("spot-check")).toHaveCount(0);
    await page.goto("/evals");
    await expect(page.getByRole("link", { name: "1 of 2 checked, 1 agreed" })).toBeVisible();
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
    // An Express server with no user interface: API design is suggested, Accessibility is not.
    await expect(page.getByRole("checkbox", { name: "API design" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Accessibility" })).not.toBeChecked();
    // Andrii's untick outlasts the next detection, which suggests it again.
    await page.getByRole("checkbox", { name: "API design" }).uncheck();
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
    await expect(page.getByRole("checkbox", { name: "API design" })).not.toBeChecked();
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

test("a suggestion that a later detection drops unticks its box, as a reload would", async ({ page }) => {
    const repo = mkdtempSync(join(tmpdir(), "auditdesk-e2e-api-"));
    const commit = (pkg: object, message: string) => {
        writeFileSync(join(repo, "package.json"), JSON.stringify(pkg));
        execFileSync("git", ["add", "package.json"], { cwd: repo });
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", message], {
            cwd: repo
        });
    };
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    writeFileSync(join(repo, "server.js"), "\n");
    execFileSync("git", ["add", "server.js"], { cwd: repo });
    commit({ name: "api", dependencies: { express: "4.21.2" } }, "an API");
    await newProject(page, "Suggestion gone", repo);
    const notes = page.locator("details", { hasText: "Stack and instructions" });
    await notes.locator("summary").click();
    await notes.getByRole("button", { name: "Detect stack" }).click();
    await expect(page.getByRole("checkbox", { name: "API design" })).toBeChecked();
    commit({ name: "api", dependencies: {} }, "no server any more");
    await notes.getByRole("button", { name: "Detect stack" }).click();
    await expect(page.getByRole("checkbox", { name: "API design" })).not.toBeChecked();
    rmSync(repo, { recursive: true, force: true });
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
    await expect(page.locator("article.finding", { hasText: "User input reaches eval" })).toBeHidden();
    await expect(page.locator("article.finding", { hasText: "Generic API Key" })).toBeVisible();
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

test("the run form estimates the cost for the agents, the model and the effort it would start", async ({ page }) => {
    await finishedRun(page, "Estimate");
    await page.getByRole("link", { name: "Estimate", exact: true }).click();
    const estimate = page.getByTestId("estimate");
    await expect(estimate).toContainText(/for 1 agent, from \d+ past agents? on this model and effort/);
    await page.getByRole("checkbox", { name: "Data model and database" }).check();
    await expect(estimate).toContainText("for 2 agents,");
    await page.locator('select[name="effort"]').selectOption("max");
    await expect(estimate).toContainText(/for 2 agents, from \d+ past agents? on this model at \w+ effort, which may cost less/);
});

test("the run shows its spend per serving model, and the report states the cost only when asked", async ({ page }) => {
    await finishedRun(page, "Cost");
    await expect(page.getByTestId("served-by").first()).toContainText("claude-sonnet-5-5 · 4 calls");
    await page.getByRole("link", { name: "Review the findings" }).click();
    const accepted = page.locator("details", { hasText: "User input reaches eval" });
    await accepted.locator("summary").click();
    await accepted.getByRole("button", { name: "Accept" }).click();
    await expect(accepted).toContainText("accepted");
    await page.getByRole("button", { name: "Export", exact: true }).click();
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

test("every page fits a narrow window, and a select's arrow keeps the fields' inner margin", async ({ page }) => {
    await finishedRun(page, "Narrow");
    const run = new URL(page.url()).pathname;
    await page.getByRole("link", { name: "Review the findings" }).click();
    await page.waitForURL(/\/findings$/);
    const findings = new URL(page.url()).pathname;
    const project = findings.replace(/\/findings$/, "");
    for (const width of [550, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of ["/", project, findings, `${findings}/1`, run, "/evals", "/settings"]) {
            await page.goto(path);
            await page.evaluate(() => document.querySelectorAll("details").forEach(d => (d.open = true)));
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow, `${path} at ${width} px`).toBeLessThanOrEqual(0);
        }
    }
    await page.goto(findings);
    const style = await page.getByLabel("Aspect").evaluate(el => {
        const s = getComputedStyle(el);
        return { appearance: s.appearance, padding: parseFloat(s.paddingRight), image: s.backgroundImage, position: s.backgroundPosition };
    });
    expect(style).toMatchObject({ appearance: "none", image: expect.stringContaining("svg"), position: "calc(100% - 12px) 50%" });
    expect(style.padding).toBeGreaterThanOrEqual(36);
    // The export panel opens inside a phone's width too.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const panel = (await page.getByRole("dialog", { name: "Export" }).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
});

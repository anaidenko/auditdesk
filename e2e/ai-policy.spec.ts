import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A repository with synthetic rules of two tools, none a client's. */
function policyRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), "auditdesk-e2e-policy-"));
    const files: Record<string, string> = {
        ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Read(./certs/**)", "Read(~/.ssh/**)"] } }, null, 2),
        ".cursorignore": "*.p12\n",
        "certs/server.key": "synthetic\n",
        "certs/server.crt": "synthetic\n",
        "store/client.p12": "synthetic\n",
        "package.json": JSON.stringify({ name: "api", dependencies: { express: "4.21.2" } }),
        "server.js": 'require("express")().listen(3000);\n'
    };
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), content);
    }
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "init"], {
        cwd: repo
    });
    return repo;
}

test("the client's AI policy is read with the stack, with the auditor's own patterns saved with the consent", async ({ page }) => {
    const repo = policyRepo();
    await page.goto("/");
    await page.getByLabel("Project name").fill("AI policy");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Repository URL or path").fill(repo);
    await page.getByRole("button", { name: "Add repository" }).click();
    await expect(page.getByText(repo).first()).toBeVisible();

    const policy = page.getByTestId("ai-policy");
    await expect(policy.locator("summary")).toContainText("not read yet");
    const notes = page.locator("details", { hasText: "Stack and instructions" });
    await notes.locator("summary").click();
    await notes.getByRole("button", { name: "Detect stack" }).click();
    await expect(policy.locator("summary")).toContainText("3 files excluded");
    await policy.locator("summary").click();
    await expect(policy).toContainText(".claude/settings.json · Claude Code · 2 patterns · 2 files");
    await expect(policy).toContainText("Read(~/.ssh/**) (outside the repository, not applicable)");
    await expect(policy).toContainText(".cursorignore · Cursor · 1 pattern · 1 file");
    await expect(policy).toContainText("Excluded, 3 files of 7: certs/ (2 files), store/client.p12");

    // The auditor's own pattern goes in with the consent, and joins the policy at the next detection.
    await page.getByLabel(/Excluded by the client in/).fill("server.js");
    await page.getByLabel(/client agreed/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^recorded \d{4}-\d{2}-\d{2}$/)).toBeVisible();
    await notes.getByRole("button", { name: "Detect stack" }).click();
    await expect(policy.locator("summary")).toContainText("4 files excluded");
    await expect(policy).toContainText("the auditor's exclusions · the auditor · 1 pattern · 1 file");
    await page.reload();
    await expect(page.getByLabel(/Excluded by the client in/)).toHaveValue("server.js");
    rmSync(repo, { recursive: true, force: true });
});

// The public sample report (docs/sample-report.html and .pdf): OWASP Juice Shop, prepared as the
// eval prepares it (evals/prep), audited through the app's own runner and reviewed in the app.
//   pnpm tsx --conditions=react-server scripts/sample-report.mts run <model> <effort> <budget-usd> [<thousand-tokens>=1200]
//   pnpm tsx --conditions=react-server scripts/sample-report.mts export <projectId>
// `run` makes a project of the prepared tree and runs it on the Claude plan, a live run that
// spends the plan's window; `export` writes the report of the findings reviewed since.
// Stop the app before `run` and start it only after: the script runs the job itself, and the
// app's runner would claim it or, starting, mark it interrupted.
// .mts for top-level await, as scripts/smoke.mts.
import nextEnv from "@next/env";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

nextEnv.loadEnvConfig(process.cwd());

const { workspaceDir } = await import("../src/engine/config");
const { loadFixtures } = await import("../evals/fixtures");
const { prepareFixture } = await import("../evals/prep/fixture");
const { JUICE_SHOP_RULES } = await import("../evals/prep/juice-shop");
const { prisma } = await import("../src/server/db");

const [command, ...args] = process.argv.slice(2);
const spec = loadFixtures().find(f => f.name === "juice-shop")!;
const RELEASE = spec.release!;

if (command === "run") {
    const [model, effort, usd, kTokens = "1200"] = args;
    const { parseRunForm } = await import("../src/server/forms");
    const fd = new FormData();
    for (const a of spec.aspects as string[]) fd.append("aspects", a);
    for (const [k, v] of Object.entries({ model: model ?? "", effort: effort ?? "", budgetUsd: usd ?? "", budgetKTokens: kTokens }))
        fd.set(k, v);
    const form = parseRunForm(fd, 1);
    if (!form.ok) throw new Error(`${form.error} Usage: run <model> <effort> <budget-usd> [<thousand-tokens>]`);
    const active = await prisma.job.count({ where: { status: { in: ["queued", "running"] } } });
    if (active) throw new Error(`${active} job(s) are queued or running: let the app finish them, then stop it.`);
    const port = process.env.PORT ?? "3000";
    const up = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(
        () => true,
        () => false
    );
    if (up) throw new Error(`The app answers on 127.0.0.1:${port}: stop it first.`);
    const { enqueueRun, claimJob } = await import("../src/server/jobs");
    const { processJob } = await import("../src/server/runner");
    const prepared = await prepareFixture({ name: spec.name, url: spec.url!, sha: spec.sha, rules: JUICE_SHOP_RULES }, workspaceDir());
    // A copy of its own: the next eval's prep replaces the prepared tree.
    const tree = join(workspaceDir(), "samples", `juice-shop-${RELEASE}-${prepared.preparedSha.slice(0, 7)}`);
    await mkdir(join(workspaceDir(), "samples"), { recursive: true });
    if (!existsSync(tree)) execFileSync("git", ["clone", "--quiet", prepared.path, tree]);
    const project = await prisma.project.create({
        data: {
            name: `OWASP Juice Shop ${RELEASE}`,
            aiConsentAt: new Date(),
            modelAccess: "claude_plan",
            briefProduct: "An online shop, deliberately insecure for security training: graded here as if it were a production app.",
            briefSavedAt: new Date()
        }
    });
    await prisma.repository.create({ data: { projectId: project.id, source: tree, branch: "main" } });
    const runId = await enqueueRun(project.id, {
        model: form.value.model,
        effort: form.value.effort,
        modelAccess: "claude_plan",
        aspects: form.value.aspects,
        budgetUsd: form.value.budgetUsd,
        budgetTokens: form.value.budgetTokens
    });
    const job = await claimJob({ runId });
    if (!job) throw new Error(`Run ${runId}'s job was taken by another runner: follow it in the app.`);
    console.log(`Project ${project.id}, run ${runId}: auditing ${tree} (prepared ${prepared.preparedSha})…`);
    await processJob(job as never);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    console.log(`Run ${run.status}${run.error ? `: ${run.error}` : ""}. Review the findings at /projects/${project.id}/findings.`);
} else if (command === "export") {
    const [projectId] = args;
    const { loadReportData } = await import("../src/server/report");
    const { renderReport } = await import("../src/engine/report/render");
    const { renderPdf } = await import("../src/engine/report/pdf");
    const data = await loadReportData(projectId);
    const sha = data.repositories[0]?.sha ?? "";
    // The method names what the sample audited, so its line numbers can be found again.
    const note = `<li>This sample audited OWASP Juice Shop ${RELEASE} (upstream <code>${spec.sha}</code>) as Auditdesk's eval prepares it (<a href="https://github.com/anaidenko/auditdesk/tree/main/evals/prep">evals/prep</a>): the answers to its coding challenges removed and its challenges renamed, in one commit, <code>${sha.slice(0, 12)}</code>. Line numbers refer to that prepared tree.</li>`;
    const html = renderReport(data).replace('<ul class="method">', `<ul class="method">\n${note}`);
    if (!html.includes(note)) throw new Error("The report's method list was not found.");
    await writeFile("docs/sample-report.html", html);
    await writeFile("docs/sample-report.pdf", await renderPdf(html, { footer: `Code audit: ${data.projectName} · ${data.generatedAt}` }));
    console.log(`docs/sample-report.html and .pdf: ${data.findings.length} findings, ${data.questions.length} questions.`);
} else throw new Error("run <model> <effort> <budget-usd> | export <projectId>");
await prisma.$disconnect();

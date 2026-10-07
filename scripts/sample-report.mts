// The public sample report (docs/sample-report.html and .pdf): OWASP Juice Shop, prepared as the
// eval prepares it (evals/prep), audited through the app's own runner and reviewed in the app.
//   pnpm tsx --conditions=react-server scripts/sample-report.mts run <model> <effort> <budget-usd>
//   pnpm tsx --conditions=react-server scripts/sample-report.mts export <projectId>
// `run` makes a project of the prepared tree and runs it on the Claude plan, a live run that
// spends the plan's window; `export` writes the report of the findings reviewed since.
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
const RELEASE = "v20.2.0";

if (command === "run") {
    const [model, effort, usd] = args;
    if (!model || !effort || !(Number(usd) > 0)) throw new Error("run <model> <effort> <budget-usd>");
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
        model,
        effort,
        modelAccess: "claude_plan",
        aspects: spec.aspects as string[],
        budgetUsd: Number(usd),
        budgetTokens: 1_200_000
    });
    const job = await claimJob();
    if (!job || job.runId !== runId) throw new Error("Another job was queued first; run it from the app.");
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

import { renderPdf } from "@/engine/report/pdf";
import { renderReport } from "@/engine/report/render";
import { keepReportCopy, loadReportData, reportFileName } from "@/server/report";

export const dynamic = "force-dynamic";

/** GET, as the HTML download: the same refusal of a cross-site request, the same copy beside the clones. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Cross-site request refused", { status: 403 });
    const { projectId } = await params;
    const query = new URL(request.url).searchParams;
    const data = await loadReportData(projectId, { includeCost: query.get("cost") === "1", draft: query.get("draft") === "1" });
    const pdf = await renderPdf(renderReport(data), {
        footer: `${data.draft ? "Draft code audit" : "Code audit"}: ${data.projectName} · ${data.generatedAt}`
    });
    const name = reportFileName(data, "pdf");
    await keepReportCopy(projectId, name, pdf);
    return new Response(new Uint8Array(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` }
    });
}

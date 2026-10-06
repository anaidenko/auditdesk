import { renderPdf } from "@/engine/report/pdf";
import { renderReport } from "@/engine/report/render";
import { keepReportCopy, loadReportData, reportFileName } from "@/server/report";

export const dynamic = "force-dynamic";

/** GET, as the HTML download: the same refusal of a cross-site request, the same copy beside the clones. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Cross-site request refused", { status: 403 });
    const { projectId } = await params;
    const data = await loadReportData(projectId);
    const pdf = await renderPdf(renderReport(data), { footer: `Code audit: ${data.projectName} · ${data.generatedAt}` });
    const name = reportFileName(data, "pdf");
    await keepReportCopy(projectId, name, pdf);
    return new Response(new Uint8Array(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` }
    });
}

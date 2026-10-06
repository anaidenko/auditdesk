import { renderReport } from "@/engine/report/render";
import { keepReportCopy, loadReportData, reportFileName } from "@/server/report";

export const dynamic = "force-dynamic";

/** GET, and it changes no state of the app: it also keeps a copy beside the project's clones (design § 5). */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    // The Host allowlist stops DNS rebinding, not a page on another site that links here; that
    // request could not read the report, but it would still write a copy.
    if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Cross-site request refused", { status: 403 });
    const { projectId } = await params;
    const data = await loadReportData(projectId);
    const html = renderReport(data);
    const name = reportFileName(data, "html");
    await keepReportCopy(projectId, name, html);
    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` }
    });
}

import { agentMarkdown } from "@/engine/report/exports";
import { exportOptions, keepReportCopy, loadReportData, reportFileName } from "@/server/report";

export const dynamic = "force-dynamic";

/**
 * The report as Markdown for an AI coding agent; `?draft=1` adds the unreviewed, marked, and
 * `?hours=1` the hours, as for the issues. GET, as the HTML download: the same refusal of a
 * cross-site request, the same copy beside the clones.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Cross-site request refused", { status: 403 });
    const { projectId } = await params;
    const { includeHours, draft } = exportOptions(request.url);
    const data = await loadReportData(projectId, { includeHours, draft });
    const md = agentMarkdown(data);
    const name = reportFileName(data, "md", "ai");
    await keepReportCopy(projectId, name, md);
    return new Response(md, {
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` }
    });
}

import { issueDrafts, issuesCsv } from "@/engine/report/exports";
import { exportOptions, loadReportData, reportFileName } from "@/server/report";

export const dynamic = "force-dynamic";

/** The reported findings as issue drafts: CSV for a tracker's import, JSON for `pnpm issues:gh`. GET, and it changes nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Cross-site request refused", { status: 403 });
    const data = await loadReportData((await params).projectId, { includeHours: exportOptions(request.url).includeHours });
    const json = new URL(request.url).searchParams.get("format") === "json";
    return new Response(json ? JSON.stringify(issueDrafts(data), null, 2) : issuesCsv(issueDrafts(data)), {
        headers: {
            "Content-Type": json ? "application/json" : "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${reportFileName(data, json ? "json" : "csv", "issues")}"`
        }
    });
}

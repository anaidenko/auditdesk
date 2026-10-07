import { sarif } from "@/engine/report/exports";
import { loadReportData, reportFileName } from "@/server/report";

export const dynamic = "force-dynamic";

/** The reported findings as SARIF 2.1.0, for code-scanning tools and CI. GET, and it changes nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Cross-site request refused", { status: 403 });
    const data = await loadReportData((await params).projectId);
    return new Response(JSON.stringify(sarif(data), null, 2), {
        headers: {
            "Content-Type": "application/sarif+json",
            "Content-Disposition": `attachment; filename="${reportFileName(data, "sarif")}"`
        }
    });
}

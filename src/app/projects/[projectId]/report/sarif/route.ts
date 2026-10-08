import { sarif } from "@/engine/report/exports";
import { loadReportData, reportFileName } from "@/server/report";

export const dynamic = "force-dynamic";

/**
 * One repository's reported findings as SARIF 2.1.0, for code scanning and CI: `?repository=`
 * names it, and may be left out when the project has one; `?draft=1` adds the unreviewed, marked.
 * GET, and it changes nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Cross-site request refused", { status: 403 });
    const query = new URL(request.url).searchParams;
    const data = await loadReportData((await params).projectId, { draft: query.get("draft") === "1" });
    const names = data.repositories.map(r => r.name);
    const name = query.get("repository") ?? (names.length === 1 ? names[0] : null);
    if (!name || !names.includes(name))
        return new Response(`Name one repository with ?repository=: ${names.join(", ") || "the project has none"}.`, { status: 400 });
    return new Response(JSON.stringify(sarif(data, name), null, 2), {
        headers: {
            "Content-Type": "application/sarif+json",
            "Content-Disposition": `attachment; filename="${reportFileName(data, "sarif", name)}"`
        }
    });
}

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { workspaceDir } from "@/engine/config";
import { renderReport } from "@/engine/report/render";
import { loadReportData } from "@/server/report";

export const dynamic = "force-dynamic";

/** GET, and it changes no state of the app: it also keeps a copy beside the project's clones (design § 5). */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const data = await loadReportData(projectId);
    const html = renderReport(data);
    const name = `auditdesk-${data.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${data.generatedAt}.html`;
    const dir = join(workspaceDir(), projectId, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), html);
    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` }
    });
}

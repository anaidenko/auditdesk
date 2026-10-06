import { chromium } from "playwright-core";

import { escapeHtml } from "./render";

/**
 * The report's HTML as a PDF (design § 10): Chromium prints it with the report's own print
 * style (A4, its @page margins), page numbers in the footer.
 */
export async function renderPdf(html: string, o: { footer?: string; onRefused?: (url: string) => void } = {}): Promise<Buffer> {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        // The report is one self-contained file: a request from it could only come from injected content.
        await page.route("**/*", route => {
            o.onRefused?.(route.request().url());
            return route.abort();
        });
        await page.setContent(html, { waitUntil: "load" });
        return await page.pdf({
            preferCSSPageSize: true,
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: "<span></span>",
            footerTemplate: `<div style="width:100%;margin:0 15mm;display:flex;justify-content:space-between;font:8px system-ui,sans-serif;color:#a1a1aa"><span>${escapeHtml(o.footer ?? "")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
        });
    } finally {
        await browser.close();
    }
}

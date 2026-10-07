import { describe, expect, it } from "vitest";

import { reportData, reportFinding } from "@/test/report-data";

import { renderPdf } from "./pdf";
import { renderReport } from "./render";

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

describe("renderPdf", { timeout: 60_000 }, () => {
    it("prints the report as a PDF: the cover alone, then new pages for the findings and the open questions", async () => {
        const html = renderReport(reportData({ questions: [reportFinding({ label: "F-003", severity: null })] }));
        const pdf = await renderPdf(html, { footer: "Code audit: Acme" });
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        // The cover; the contents, summary and scope; the findings; the open questions with the disclaimer.
        expect(pages(pdf)).toBeGreaterThanOrEqual(4);
    });

    it("prints the cards' closed details: Chromium fires beforeprint, and the report opens them", async () => {
        const long = Array.from({ length: 6 }, (_, i) =>
            reportFinding({ label: `F-00${i + 1}`, explanation: "A sentence of the details. ".repeat(250) })
        );
        const html = renderReport(reportData({ findings: long }));
        const noScript = html.replace(/<script>[\s\S]*?<\/script>/, "");
        const printed = pages(await renderPdf(html));
        expect(printed).toBeGreaterThan(pages(await renderPdf(noScript)));
        expect(printed).toBe(pages(await renderPdf(html.replaceAll('<details class="body">', '<details class="body" open>'))));
    });

    it("refuses every request the page makes: the report is one self-contained file", async () => {
        const refused: string[] = [];
        await renderPdf(
            '<html><body><img src="http://example.com/x.png"><link rel="stylesheet" href="https://example.com/a.css"></body></html>',
            {
                onRefused: url => void refused.push(url)
            }
        );
        expect(refused).toEqual(expect.arrayContaining(["http://example.com/x.png", "https://example.com/a.css"]));
    });
});

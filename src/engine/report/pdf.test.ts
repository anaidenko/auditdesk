import { describe, expect, it } from "vitest";

import { reportData, reportFinding } from "@/test/report-data";

import { renderPdf } from "./pdf";
import { renderReport } from "./render";

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

describe("renderPdf", { timeout: 60_000 }, () => {
    it("prints the report as a PDF with a page at least for each section", async () => {
        const html = renderReport(reportData({ questions: [reportFinding({ label: "F-003", severity: null })] }));
        const pdf = await renderPdf(html, { footer: "Code audit: Acme" });
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        // Cover, contents, summary, scope, findings, open questions (the disclaimer shares a page).
        expect(pages(pdf)).toBeGreaterThanOrEqual(6);
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

import { type Browser, chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reportData as data, reportFinding as finding } from "@/test/report-data";

import { renderReport } from "./render";

// The report's script and print style, in the Chromium that prints the PDF.
describe("the report in a browser", { timeout: 60_000 }, () => {
    let browser: Browser;
    beforeAll(async () => {
        browser = await chromium.launch();
    });
    afterAll(() => browser.close());
    const open = async (html: string) => {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        return page;
    };

    it("counts the findings the filters show", async () => {
        const page = await open(renderReport(data()));
        expect(await page.locator(".filters output").textContent()).toBe("2 of 2 findings shown");
        await page.locator('.filters select[name="sev"]').selectOption("critical");
        expect(await page.locator(".filters output").textContent()).toBe("1 of 2 findings shown");
    });

    it("prints twelve lines of a long excerpt and says how many more the HTML report holds", async () => {
        const snippet = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
        const page = await open(
            renderReport(data({ findings: [finding({ evidence: [{ file: "a.ts", startLine: 1, endLine: 30, snippet }] })] }))
        );
        const shown = () => page.locator("figure .ln").evaluateAll(els => els.filter(el => el.checkVisibility()).length);
        expect(await shown()).toBe(30);
        expect(await page.locator("figure .cut").isVisible()).toBe(false);
        await page.emulateMedia({ media: "print" });
        expect(await shown()).toBe(12);
        expect(await page.locator("figure .cut").innerText()).toBe("18 more lines in the HTML report");
    });

    it("prints ten places of a card and says how many more the HTML report holds", async () => {
        const evidence = Array.from({ length: 13 }, (_, i) => ({ file: `src/f${i}.ts`, startLine: 1, endLine: 1, snippet: `k${i}` }));
        const page = await open(renderReport(data({ findings: [finding({ evidence })] })));
        const figures = () => page.locator("figure").evaluateAll(els => els.filter(el => el.checkVisibility()).length);
        expect(await figures()).toBe(10);
        expect(await page.locator(".more > summary").innerText()).toBe("and 3 more places");
        await page.emulateMedia({ media: "print" });
        expect(await figures()).toBe(10);
        expect(await page.locator(".more > summary").innerText()).toBe("and 3 more places in the HTML report");
    });
});

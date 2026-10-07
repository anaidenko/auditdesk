import { type Browser, chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reportData as data } from "@/test/report-data";

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
});

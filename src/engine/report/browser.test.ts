import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "playwright-core";
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

    const bodies = (page: Page) => page.locator(".finding > .body").evaluateAll(els => els.map(d => (d as HTMLDetailsElement).open));
    const toggle = (page: Page) => page.locator(".filters button.all");

    // WCAG 2.1 AA: 4.5:1 for small text (1.4.3); a link in running text is underlined (1.4.1).
    const contrast = (page: Page, selector: string) =>
        page
            .locator(selector)
            .first()
            .evaluate(el => {
                const rgba = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
                let bg: number[] | null = null;
                let opacity = 1;
                for (let n: Element | null = el; n; n = n.parentElement) {
                    const style = getComputedStyle(n);
                    opacity *= Number(style.opacity);
                    const c = rgba(style.backgroundColor);
                    if (!bg && (c[3] ?? 1) > 0) bg = c.slice(0, 3);
                }
                const base = bg ?? [255, 255, 255];
                const fg = rgba(getComputedStyle(el).color)
                    .slice(0, 3)
                    .map((v, i) => v * opacity + base[i] * (1 - opacity));
                const lum = (c: number[]) => {
                    const [r, g, b] = c.map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
                    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
                };
                const [hi, lo] = [lum(fg), lum(base)].sort((x, y) => y - x);
                return (hi + 0.05) / (lo + 0.05);
            });

    it("fits a phone's width: the severity tiles wrap instead of running off the page", async () => {
        const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
        await page.setContent(renderReport(data()), { waitUntil: "load" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    });

    it("keeps its quiet text readable: an empty severity tile, the colophon, and a link inside the method", async () => {
        const page = await open(renderReport(data({ auditorUrl: "https://naidenko.dev/", methodUrl: "https://naidenko.dev/audit" })));
        expect(await contrast(page, ".tile.zero span")).toBeGreaterThanOrEqual(4.5);
        expect(await contrast(page, ".tile.zero b")).toBeGreaterThanOrEqual(4.5);
        expect(await contrast(page, ".colophon")).toBeGreaterThanOrEqual(4.5);
        expect(
            await page
                .locator(".method a")
                .first()
                .evaluate(a => getComputedStyle(a).textDecorationLine)
        ).toBe("underline");
    });

    it("opens each card's details on demand, and every one with Expand all", async () => {
        const page = await open(renderReport(data()));
        expect(await bodies(page)).toEqual([false, false]);
        expect(await page.locator("#F-001 .callout").isVisible()).toBe(true);
        expect(await page.locator("#F-001 .lead").isVisible()).toBe(false);
        await toggle(page).click();
        expect(await bodies(page)).toEqual([true, true]);
        await expect.poll(() => toggle(page).textContent()).toBe("Collapse all");
        await toggle(page).click();
        expect(await bodies(page)).toEqual([false, false]);
        await expect.poll(() => toggle(page).textContent()).toBe("Expand all");
        for (const id of ["F-001", "F-002"]) await page.locator(`#${id} .body > summary`).click();
        await expect.poll(() => toggle(page).textContent()).toBe("Collapse all");
    });

    it("opens the card a link points at, on load, on a click and on a click repeated", async () => {
        const file = join(mkdtempSync(join(tmpdir(), "report-")), "r.html");
        writeFileSync(file, renderReport(data()));
        const page = await browser.newPage();
        await page.goto(`file://${file}#F-002`);
        expect(await bodies(page)).toEqual([false, true]);
        await page.locator('#summary a[href="#F-001"]').click();
        expect(await bodies(page)).toEqual([true, true]);
        await page.locator("#F-001 .body > summary").click();
        expect(await bodies(page)).toEqual([false, true]);
        await page.locator('#summary a[href="#F-001"]').click();
        expect(await bodies(page)).toEqual([true, true]);
    });

    it("leaves the filters alone when a link is opened in a new tab", async () => {
        const page = await open(renderReport(data()));
        await page.locator('.filters select[name="sev"]').selectOption("critical");
        await page.locator('#summary a[href="#F-002"]').click({ modifiers: ["ControlOrMeta"] });
        expect(await page.locator('.filters select[name="sev"]').inputValue()).toBe("critical");
        expect(await bodies(page)).toEqual([false, false]);
    });

    const zebras = () =>
        renderReport(
            data({
                findings: [
                    finding({ label: "F-001", explanation: "zebra" }),
                    finding({ label: "F-002", explanation: "zebra" }),
                    finding({ label: "F-003", severity: "low", explanation: "zebra" })
                ]
            })
        );
    const search = (page: Page, q: string) => page.locator('.filters input[name="q"]').fill(q);

    it("keeps closed a body the reader closed during a search when another filter changes, until the search changes", async () => {
        const page = await open(zebras());
        await search(page, "zebra");
        expect(await bodies(page)).toEqual([true, true, true]);
        await page.locator("#F-001 .body > summary").click();
        await page.locator('.filters select[name="sev"]').selectOption("high");
        expect(await bodies(page)).toEqual([false, true, false]);
        await search(page, "zebr");
        expect(await bodies(page)).toEqual([true, true, false]);
    });

    it("keeps every body closed after Collapse all when another filter changes", async () => {
        const page = await open(zebras());
        await search(page, "zebra");
        await toggle(page).click();
        expect(await bodies(page)).toEqual([false, false, false]);
        await page.locator('.filters select[name="sev"]').selectOption("high");
        expect(await bodies(page)).toEqual([false, false, false]);
    });

    it("leaves open a body the search opened once the reader has used it: its toggle, a link, Expand all", async () => {
        const toggled = await open(zebras());
        await search(toggled, "zebra");
        await toggled.locator("#F-001 .body > summary").click();
        await toggled.locator("#F-001 .body > summary").click();
        await search(toggled, "");
        expect(await bodies(toggled)).toEqual([true, false, false]);
        const linked = await open(zebras());
        await search(linked, "zebra");
        await linked.locator('#summary a[href="#F-002"]').click();
        await search(linked, "");
        expect(await bodies(linked)).toEqual([false, true, false]);
        const expanded = await open(zebras());
        await expanded.locator('.filters select[name="sev"]').selectOption("high");
        await search(expanded, "zebra");
        await expect.poll(() => toggle(expanded).textContent()).toBe("Expand all");
        await toggle(expanded).click();
        await search(expanded, "");
        expect(await bodies(expanded)).toEqual([true, true, true]);
    });

    it("searches the cards' own words: not the toggle's label, not a card the filters hide", async () => {
        const page = await open(
            renderReport(
                data({
                    findings: [
                        finding({ label: "F-001", evidence: [] }),
                        finding({ label: "F-002", severity: "low", explanation: "zebra" })
                    ]
                })
            )
        );
        await search(page, "evidence");
        expect(await page.locator(".filters output").textContent()).toBe("1 of 2 findings shown");
        await search(page, "details and");
        expect(await page.locator(".filters output").textContent()).toBe("0 of 2 findings shown");
        expect(await bodies(page)).toEqual([false, false]);
        await page.locator('.filters select[name="sev"]').selectOption("high");
        await search(page, "zebra");
        expect(await bodies(page)).toEqual([false, false]);
    });

    it("names each card and each toggle after the finding", async () => {
        const page = await open(renderReport(data()));
        expect(await page.getByRole("article", { name: /F-001.*Raw SQL/ }).count()).toBe(1);
        expect(await page.locator("#F-001 .body > summary").evaluate(s => s.textContent)).toBe("Details and evidence for F-001");
        expect(await page.locator("#F-001 .body > summary").innerText()).toContain("Details and evidence");
    });

    it("opens a body the search matches inside, and closes it when the search moves on", async () => {
        const page = await open(
            renderReport(data({ findings: [finding({ label: "F-001", explanation: "zebra" }), finding({ label: "F-002" })] }))
        );
        await page.locator("#F-002 .body > summary").click();
        await page.locator('.filters input[name="q"]').fill("zebra");
        expect(await bodies(page)).toEqual([true, true]);
        await page.locator('.filters input[name="q"]').fill("");
        expect(await bodies(page)).toEqual([false, true]);
    });

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
        await page.locator(".finding .body > summary").click();
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
        await page.locator(".finding .body > summary").click();
        const figures = () => page.locator("figure").evaluateAll(els => els.filter(el => el.checkVisibility()).length);
        expect(await figures()).toBe(10);
        expect(await page.locator(".more > summary").innerText()).toBe("and 3 more places");
        await page.emulateMedia({ media: "print" });
        expect(await figures()).toBe(10);
        expect(await page.locator(".more > summary").innerText()).toBe("and 3 more places in the HTML report");
    });

    const thirteen = () =>
        renderReport(
            data({
                findings: [
                    finding({
                        evidence: Array.from({ length: 13 }, (_, i) => ({
                            file: `src/f${i}.ts`,
                            startLine: 1,
                            endLine: 1,
                            snippet: `k${i}`
                        }))
                    })
                ]
            })
        );

    it("prints a list of places the reader opened without promising the rest elsewhere", async () => {
        const page = await open(thirteen());
        await page.locator(".finding .body > summary").click();
        await page.locator(".more > summary").click();
        await page.emulateMedia({ media: "print" });
        expect(await page.locator("figure").evaluateAll(els => els.filter(el => el.checkVisibility()).length)).toBe(13);
        expect(await page.locator(".more > summary").innerText()).toBe("and 3 more places");
    });

    it("opens the list of places when a search matches a place inside it", async () => {
        const page = await open(thirteen());
        await page.locator('.filters input[name="q"]').fill("src/f12");
        expect(await page.locator(".more").evaluate(d => (d as HTMLDetailsElement).open)).toBe(true);
        expect(await page.locator(".filters output").textContent()).toBe("1 of 1 findings shown");
        await page.locator('.filters input[name="q"]').fill("");
        expect(await page.locator(".more").evaluate(d => (d as HTMLDetailsElement).open)).toBe(false);
    });

    it("prints every card expanded, then gives the reader back the cards they had open", async () => {
        const page = await open(renderReport(data()));
        await page.locator("#F-002 .body > summary").click();
        await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
        await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
        expect(await bodies(page)).toEqual([true, true]);
        await page.emulateMedia({ media: "print" });
        expect(await page.locator("#F-001 .body > summary").isVisible()).toBe(false);
        expect(await page.locator("#F-001 .lead").isVisible()).toBe(true);
        await page.evaluate(() => dispatchEvent(new Event("afterprint")));
        expect(await bodies(page)).toEqual([false, true]);
    });

    it("prints open questions expanded in a report with no findings and no filters bar", async () => {
        const page = await open(renderReport(data({ findings: [], questions: [finding({ label: "F-009", severity: null })] })));
        await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
        expect(await bodies(page)).toEqual([true]);
    });

    it("keeps the ten-place cap in print", async () => {
        const page = await open(thirteen());
        await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
        await page.emulateMedia({ media: "print" });
        expect(await page.locator("figure").evaluateAll(els => els.filter(el => el.checkVisibility()).length)).toBe(10);
        expect(await page.locator(".more").evaluate(d => (d as HTMLDetailsElement).open)).toBe(false);
    });

    it("keeps a Summary line's title readable at phone width", async () => {
        const page = await open(
            renderReport(data({ findings: [finding({ title: "Raw SQL in the search endpoint lets anyone read every table" })] }))
        );
        await page.setViewportSize({ width: 390, height: 800 });
        const box = await page
            .locator("#summary .risks li")
            .first()
            .evaluate(li => {
                const [title, aside] = [...li.querySelectorAll("span")].slice(-2);
                return {
                    title: title.getBoundingClientRect().width,
                    overflow: aside.getBoundingClientRect().right - li.getBoundingClientRect().right
                };
            });
        expect(box.title).toBeGreaterThan(200);
        expect(box.overflow).toBeLessThanOrEqual(0);
    });
});

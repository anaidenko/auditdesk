import { expect, test } from "@playwright/test";

test("every page names the app's icon, so the browser does not ask for a missing /favicon.ico", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="icon"]').first().getAttribute("href");
    expect(href).toMatch(/\/icon\.svg/);
    expect((await request.get(href!)).status()).toBe(200);
});

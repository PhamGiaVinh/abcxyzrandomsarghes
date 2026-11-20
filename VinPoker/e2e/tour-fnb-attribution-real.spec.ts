import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("the finance panel switches between two tours through the real F&B reader", async ({ browser }) => {
  const fixturePath = process.env.LOCAL_TOUR_FNB_BROWSER_FIXTURE;
  test.skip(!fixturePath, "Requires an isolated PostgREST fixture with two TEST tours");
  const fixture = JSON.parse(readFileSync(fixturePath!, "utf8"));
  const frontend = new URL(process.env.PLAYWRIGHT_BASE_URL!);
  const rest = new URL(fixture.restUrl);
  for (const url of [frontend, rest]) {
    expect(url.protocol).toBe("http:");
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  }
  expect(fixture.tourId).not.toBe(fixture.otherTourId);

  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    await test.step(`report at ${viewport.width}px`, async () => {
      const context = await browser.newContext({ viewport, locale: "vi-VN" });
      try {
        const page = await context.newPage();
        // Serve only the HTML host in Playwright. Vite serves the production
        // component and reader, and every RPC goes to the real HTTP service.
        await page.route(new URL("/tour-fnb-test-host", frontend).href, route =>
          route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' }));
        await page.goto(new URL("/tour-fnb-test-host", frontend).href);
        await page.evaluate(async fixtureConfig => {
          const host = "/e2e/tour-fnb-attribution-host.tsx";
          const { mountTourReport } = await import(host);
          mountTourReport(fixtureConfig);
        }, fixture);

        const selector = page.getByLabel("Giải cần xem", { exact: true });
        const section = page.getByRole("region", { name: "F&B theo giải" });
        await selector.selectOption(fixture.tourId);
        await expect(section.getByText("20.000 đ", { exact: true })).toBeVisible();
        await expect(section.getByText("5.000 đ", { exact: true })).toBeVisible();
        const responsePromise = page.waitForResponse(response =>
          response.url() === `${fixture.restUrl}/rpc/get_tour_fnb_attribution_v1` &&
          response.request().postDataJSON()?.p_tournament_id === fixture.otherTourId,
        );
        const [response] = await Promise.all([responsePromise, selector.selectOption(fixture.otherTourId)]);
        expect(response.ok()).toBe(true);
        expect(await response.json()).toMatchObject({ coverage: "captured_orders_only", revenue: 0, cogs: 0, sales: 0 });
        await expect(section.getByText("Chưa có giao dịch F&B đã ghi nhận cho giải này.")).toBeVisible();
        await expect(section.getByText("20.000 đ", { exact: true })).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
});

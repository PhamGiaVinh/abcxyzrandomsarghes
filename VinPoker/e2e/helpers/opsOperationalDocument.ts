import type { Page } from "@playwright/test";

// Transport-only destination: these tests prove the guarded document transition.
// Real operational rendering is checked separately by authenticated hosted smoke.
export async function installOperationalDocument(page: Page, destination: string) {
  await page.route(url => url.pathname === destination, route => route.fulfill({
    contentType: "text/html", body: '<!doctype html><html><body><main><h1>Operational destination</h1></main></body></html>',
  }));
}

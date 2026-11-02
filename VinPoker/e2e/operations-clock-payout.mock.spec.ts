import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`public clock freezes paused server time and resumes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.clock.install();
    let running = false;
    const publicReads: string[] = [];
    const unexpectedWrites: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    // Anonymous loopback fixture only; no credentials or production API access.
    await page.route('http://127.0.0.1:54321/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const clockRead = path.endsWith('/rpc/get_public_tournament_clock_summary');
      const resultRead = path.endsWith('/rpc/get_public_tournament_results');
      if (clockRead || resultRead) publicReads.push(path);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !clockRead && !resultRead) {
        unexpectedWrites.push(path);
      }
      const serverNow = clockRead && running ? await page.evaluate(() => Date.now()) : 0;
      const body = clockRead ? [{ tournament_id: 'public-clock-test', name: 'Clock pause TEST',
        current_level: 1, small_blind: 100, big_blind: 200, big_blind_ante: 200,
        remaining_seconds: 125, is_running: running,
        level_ends_at: running ? new Date(serverNow + 120000).toISOString() : null,
        entries: 8, players_remaining: 8, average_stack: 20000,
      }] : [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/clock/public-clock-test');
    try {
      await expect(page.getByText('02:05', { exact: true })).toBeVisible();
    } catch (error) {
      // Only local synthetic page data and RPC paths; no tokens, headers or auth storage.
      throw new Error(`Public clock startup failed: ${JSON.stringify({publicReads,pageErrors,
        body:await page.locator('body').innerText()})}`,{cause:error});
    }
    await expect(page.getByText('Đồng hồ đang dừng', { exact: true })).toBeVisible();
    await page.clock.runFor(5000);
    await expect(page.getByText('02:05', { exact: true })).toBeVisible();
    running = true;
    await page.clock.runFor(10000);
    await expect(page.getByText('Đồng hồ đang dừng', { exact: true })).toHaveCount(0);
    await page.clock.runFor(2000);
    await expect(page.getByText('01:58', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(unexpectedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const surface of ["clock", "panels"]) {
  test(`${surface}: mobile and tablet content remains reachable`, async ({ page }) => {
    const writes: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") pageErrors.push(message.text()); });
    page.on("requestfailed", request => pageErrors.push(`${new URL(request.url()).origin}${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    await page.addInitScript(() => {
      // Synthetic session exists only in the loopback Playwright fixture.
      localStorage.setItem("sb-127-auth-token", JSON.stringify({
        access_token: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMyJ9.",
        refresh_token: "mock-refresh-token", expires_at: 4102444800, token_type: "bearer",
        user: { id: "00000000-0000-4000-8000-000000000003", aud: "authenticated", role: "authenticated",
          email: "operator@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-08-09T00:00:00.000Z" },
      }));
    });
    await page.route("http://127.0.0.1:54321/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/rest/v1/profiles" && request.method() === "PATCH") {
        // AuthProvider's fixed login mapping is isolated from clock/payout writes.
        expect(new URL(request.url()).searchParams.get("user_id")).toBe("eq.00000000-0000-4000-8000-000000000003");
        expect(request.postDataJSON()).toEqual({ onesignal_external_user_id: "00000000-0000-4000-8000-000000000003" });
        await route.fulfill({ status: 204 });
        return;
      }
      const isReadRpc = ["get_tournament_clock", "get_tournament_leaderboard"].some((name) => path.endsWith(`/rpc/${name}`));
      const isAllowedRead = ["GET", "HEAD"].includes(request.method()) || (request.method() === "POST" && isReadRpc);
      if (!isAllowedRead) writes.push(path);
      const level = { id: "level-test", level_number: 20, small_blind: 500000, big_blind: 1000000, ante: 1000000, duration_minutes: 20, is_break: false };
      const body = path.endsWith("/get_tournament_clock")
        ? { tournament_id: "responsive-test", status: "live", is_running: false, remaining_seconds: 1200, elapsed_seconds: 0, current_level: level, next_level: { ...level, level_number: 21 }, is_break: false, control_revision: "test-revision" }
        : path.endsWith("/get_tournament_leaderboard")
          ? { players: [{ position: 1, player_name: "Nguyễn_Văn_Tên_Dài_".repeat(8), prize: 250000000 }], prize_pool: 420000000 }
          : [{ position: 1, amount: 250000000, percentage: 60 }];
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`/e2e/fixtures/operations-responsive.html?surface=${surface}`);
    expect(pageErrors).toEqual([]);
    try {
      await expect(page.getByText(surface === "clock" ? "Kết thúc đăng ký tại Level 8" : "20:00", { exact: true })).toBeVisible();
    } finally {
      expect(pageErrors).toEqual([]);
    }
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `test-results/ops-responsive/${surface}-${viewport.width}.png`, fullPage: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (surface === "clock") {
        // Decorative background bleed is intentional; actual footer content must fit.
        await expect.poll(() => page.locator(".vpc-root").evaluate((e) => e.querySelector(".vpc-footer")!.getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom + 1)).toBe(true);
      } else {
        await expect(page.getByText("20:00", { exact: true })).toBeVisible();
        await expect(page.getByTestId("tracker-readonly-roster")).toBeVisible();
      }
    }
    expect(writes).toEqual([]);
  });
}

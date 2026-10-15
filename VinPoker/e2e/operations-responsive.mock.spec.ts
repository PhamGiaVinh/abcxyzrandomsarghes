import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`series upload failure feedback stays truthful at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:850});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let storageCalls=0,publicationCalls=0;
    await page.route('http://127.0.0.1:54321/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.includes('/storage/v1/object/')){
        storageCalls++;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({statusCode:'503',error:'unavailable',message:'Storage TEST unavailable'})});return;
      }
      if(route.request().method()==='POST')publicationCalls++;
      const data=path.endsWith('/clubs')?[{id:'club-test',name:'Schedule TEST',region:'TEST',daily_schedule_image_url:null,weekly_schedule_image_url:null}]:[];
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('/e2e/fixtures/operations-responsive.html?surface=schedule-upload');
    const input=page.locator('input[type=file][multiple]');await expect(input).toBeAttached();
    // Valid one-pixel PNG exercises the real browser compression/upload path.
    const buffer=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBksAAAAASUVORK5CYII=','base64');
    await input.setInputFiles([{name:'first.png',mimeType:'image/png',buffer},{name:'second.png',mimeType:'image/png',buffer}]);
    await expect.poll(()=>storageCalls).toBe(2);
    await expect(page.getByText('Storage TEST unavailable').first()).toBeVisible();
    await expect(page.getByText('Series schedule images published.',{exact:true})).toHaveCount(0);
    await expect(page.locator('input[type=file][multiple]')).toBeEnabled();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(publicationCalls).toBe(0);expect(errors).toEqual([]);
  });
}

for (const width of [375, 1280]) {
  test(`player action sheet explains the existing seat move at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:850});
    const calls:string[]=[];
    await page.route('http://127.0.0.1:54321/**',async route=>{
      calls.push(route.request().url());
      await route.fulfill({status:200,contentType:'application/json',body:'[]'});
    });
    await page.goto('/e2e/fixtures/operations-responsive.html?surface=player-actions');
    await expect(page.getByText(/Để chọn ghế trống/)).toBeVisible();
    await expect(page.getByText('Sắp có',{exact:true})).toHaveCount(0);
    const move=page.getByRole('button',{name:/Chuyển/});
    await expect(move).toBeVisible();await expect(move).toBeEnabled();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await move.click();
    await expect(page.getByText('Move intent TEST received')).toBeVisible();
    expect(calls).toEqual([]);
  });
}

test("chip source failure is unavailable, never a fabricated zero roster", async ({ page }) => {
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "local test unavailable" }) }));
  await page.goto("/e2e/fixtures/operations-responsive.html");
  await expect(page.getByRole("alert")).toContainText("Không tải được dữ liệu chip trên ghế");
  await expect(page.getByText("0 ghế đang active", { exact: true })).toHaveCount(0);
});

test("chip metrics and narrow mode panel contain long names and large values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/rpc/get_tournament_participation_counts_v1")) {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ p_tournament_id: "responsive-test" });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        tournament_id: "responsive-test", average_stack: 987654321000,
        counts: { total_entries: 1, re_entries: 0, remaining: 1, seated: 1, waiting: 0,
          busted: 0, anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 987654321000,
          seated_stack: 987654321000, waiting_stack: 0 },
      }) });
      return;
    }
    expect(route.request().method()).toBe("GET");
    const data = path.endsWith("/tournaments")
      ? { status: "live", players_remaining: 1, current_level: 1 }
      : path.endsWith("/tournament_levels")
        ? { small_blind: 500000, big_blind: 1000000, ante: 1000000, is_break: false }
        : [{ player_name: "CODEX_FLOOR_UAT_".repeat(8), chip_count: 987654321000 }];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/e2e/fixtures/operations-responsive.html");
  await expect(page.getByText("987.654.321.000", { exact: true }).first()).toBeVisible();
  for (const width of [360, 390, 411, 768, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Values must remain readable, not merely be wrapped to hide overflow.
    for (const value of await page.getByText("987.654.321.000", { exact: true }).all()) {
      expect((await value.boundingBox())!.height).toBeLessThanOrEqual(32);
    }
    for (const card of await page.getByRole("radio").all()) {
      const bounds = await card.boundingBox();
      expect(bounds!.width).toBeGreaterThan(250);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `test-results/ops-responsive/chips-${width}.png`, fullPage: true });
  }
  await page.getByRole("radio", { name: /Live Tracker/ }).click();
  await expect(page.getByRole("radio", { name: /Live Tracker/ })).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("Floor roster and entry picker stay usable across phone, tablet and desktop widths", async ({ page }) => {
  for (const size of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/e2e/fixtures/operations-responsive.html?surface=floor");
    const close = page.getByRole("button", { name: "Đóng danh sách bàn" });
    await expect(close).toBeVisible();
    await page.waitForTimeout(600);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const closeBounds = await close.boundingBox();
    expect(closeBounds).not.toBeNull();
    expect(closeBounds!.width).toBeGreaterThanOrEqual(48);
    expect(closeBounds!.height).toBeGreaterThanOrEqual(48);
    expect(closeBounds!.x + closeBounds!.width).toBeLessThanOrEqual(size.width);
    expect(closeBounds!.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `test-results/ops-responsive/floor-${size.width}x${size.height}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/fixtures/operations-responsive.html?surface=floor");
  await expect(page.getByText("Tom Dwan")).toBeVisible();
  await page.getByRole("searchbox", { name: "Tìm theo tên hoặc số entry" }).fill("27");
  await expect(page.getByText("Tom Dwan")).toBeVisible();
  await expect(page.getByText("Nguyễn Văn Tên Rất Dài Tại Bàn Final")).toHaveCount(0);
  await page.getByRole("tab", { name: /Đã loại 1/ }).click();
  await expect(page.getByTestId("floor-entry-restore-entry-c")).toContainText("Phil Ivey");
  await page.getByTestId("floor-entry-restore-entry-c").click();
  await expect(page.getByRole("button", { name: "Khôi phục vào ghế này" })).toBeEnabled();

  const close = page.getByRole("button", { name: "Đóng danh sách bàn" });
  await close.click();
  await expect(close).toBeHidden();
});

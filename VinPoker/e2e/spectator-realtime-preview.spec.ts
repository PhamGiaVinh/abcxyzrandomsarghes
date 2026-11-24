import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const shots = path.resolve(process.cwd(), "shots");
const viewports = [
  { name: "mobile-320", width: 320, height: 720 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-414", width: 414, height: 896 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "laptop-1366", width: 1366, height: 768 },
  { name: "laptop-1440", width: 1440, height: 900 },
  { name: "mobile-landscape", width: 844, height: 390 },
] as const;

test.beforeAll(() => fs.mkdirSync(shots, { recursive: true }));

for (const width of [320,375,390,414,1440]) {
  test(`mini pot groups fit ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await page.goto('/__dev/viewer-rpt?view=tables&pots=split');
    const table=page.getByRole('article',{name:'Bàn 14'});
    const groups=table.getByTestId('mini-pot-groups');
    await expect(groups).toBeVisible();
    await expect(groups).toContainText('50 BB');await expect(groups).toContainText('15 BB');
    await expect(groups.locator('.tracker-chip-column')).toHaveCount(6);
    const geometry=await groups.evaluate(el=>{
      const rect=el.getBoundingClientRect(),center=el.parentElement!.getBoundingClientRect();
      const columns=[...el.querySelectorAll('.tracker-chip-column')];
      return {inside:rect.left>=center.left-1&&rect.right<=center.right+1,
        colors:new Set(columns.map(column=>(column.firstElementChild as HTMLElement).style.background)).size,
        overflow:document.documentElement.scrollWidth-innerWidth};
    });
    expect(geometry).toEqual({inside:true,colors:3,overflow:0});
    await page.screenshot({path:path.join(shots,`mini-pot-groups-${width}.png`),fullPage:true});
  });
}

for (const viewport of viewports) {
  test(`spectator tables fit ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/__dev/viewer-rpt?view=tables");
    await expect(page.getByRole("region", { name: "Bàn trực tiếp" })).toBeVisible();
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    const controls = await page.locator("button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, text: button.textContent?.trim() };
    }).filter((button) => button.width > 0 && button.height > 0));
    expect(controls.filter((control) => control.width < 44 || control.height < 44)).toEqual([]);
    if (viewport.name === "mobile-390" || viewport.name === "laptop-1440") {
      await page.screenshot({ path: path.join(shots, `spectator-realtime-${viewport.name}.png`), fullPage: true });
    }
  });
}

test("payout keeps grouped amount as per-player value", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__dev/viewer-rpt?view=leaders");
  await expect(page.getByRole("region", { name: "Chip Ranking" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cơ cấu giải thưởng" })).toContainText("#3–5");
  await expect(page.getByRole("region", { name: "Cơ cấu giải thưởng" })).toContainText("250.000.000");
  await page.screenshot({ path: path.join(shots, "spectator-realtime-payout-mobile-390.png"), fullPage: true });
});

test("table catalog paginates beyond the first six tables", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__dev/viewer-rpt?view=tables&tables=many");
  await expect(page.getByText("Bàn 14", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trang bàn tiếp theo" }).click();
  await expect(page.getByText("Bàn 21", { exact: true })).toBeVisible();
});

test("simultaneous tables show only each hand's recorded cards", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/__dev/viewer-rpt?view=tables");
  const first = page.getByRole("article", { name: "Bàn 14" });
  const second = page.getByRole("article", { name: "Bàn 15" });
  await expect(first.locator('[data-card-code="QS"]')).toHaveCount(1);
  await expect(first.locator('[data-card-code="QC"]')).toHaveCount(1);
  await expect(second.locator('[data-card-code="8D"]')).toHaveCount(1);
  await expect(second.locator('[data-card-code="8H"]')).toHaveCount(1);
  await expect(first.locator('[data-card-code="8D"]')).toHaveCount(0);
  await expect(second.locator('[data-card-code="QS"]')).toHaveCount(0);
});

test("four tables update fold, call, all-in and raise without opening a table", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__dev/viewer-rpt?view=tables&motion=live");
  const expected = [
    ["Bàn 14", "fold"], ["Bàn 15", "call"],
    ["Bàn 20", "all_in"], ["Bàn 21", "raise"],
  ] as const;
  for (const [name, action] of expected) {
    const table = page.getByRole("article", { name });
    await expect(table.locator(`[data-action="${action}"]`)).toBeVisible();
    await expect(table.locator("[data-testid=table-center-blinds]")).toContainText("Level 11");
  }
  await expect(page.getByRole("article", { name: "Bàn 14" }).locator("[data-action=call]")).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("article", { name: "Bàn 20" }).locator("[data-action=raise]")).toBeVisible();
  await expect(page.locator("[data-hand-id]")).toHaveCount(4);
});

test("appearance preview changes felt before save without touching live data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__dev/viewer-rpt?view=appearance");
  const preview = page.locator(".spectator-mini-table");
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: /Màu mặt bàn #521b23/ }).click();
  await expect(preview).toHaveCSS("--table-felt", "#521b23");
  await expect(page.getByText("Dữ liệu minh họa · thay đổi chỉ áp dụng sau khi lưu.")).toBeVisible();
  await page.screenshot({ path: path.join(shots, "spectator-table-appearance-mobile-390.png"), fullPage: true });
});

for (const viewport of [{ width: 320, height: 720 }, { width: 1366, height: 768 }]) {
  test(`nine-seat table keeps player boxes separate at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/__dev/viewer-rpt?view=tables&tables=dense");
    const seats = page.getByRole("article", { name: "Bàn 14" }).locator("[data-seat-number]");
    await expect(seats).toHaveCount(9);
    const boxes = await seats.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { seat: node.getAttribute("data-seat-number"), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        `Ghế ${a.seat} đè ghế ${b.seat}`).toBe(true);
    }
  });
}

test("event navigation has exactly four top-level sections", async ({ page }) => {
  await page.goto("/__dev/viewer-rpt?view=updates");
  const navigation = page.getByRole("navigation", { name: "Trình xem ván đấu" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation).toContainText("Cập nhật");
  await expect(navigation).toContainText("Bàn LIVE");
  await expect(navigation).toContainText("Xếp hạng");
  await expect(navigation).toContainText("Cấu trúc");
});

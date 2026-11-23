import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const viewports = [320, 375, 390, 414, 768, 1024, 1366, 1440];
const metrics: unknown[] = [];
async function measure(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector('[data-tracker-table]')!;
    const rect = (element: Element) => element.getBoundingClientRect();
    const pods = [...table.querySelectorAll('[data-tracker-seat]')];
    const board = table.querySelector('[data-testid="board-cards"]') ?? table.querySelector('[data-card-code]')?.parentElement;
    const hits = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3;
    const overlaps: string[] = [];
    pods.forEach((pod, i) => {
      pods.slice(i + 1).forEach(other => { if (hits(rect(pod), rect(other))) overlaps.push(`${pod.getAttribute('data-tracker-seat')}/${other.getAttribute('data-tracker-seat')}`); });
      if (board && hits(rect(pod), rect(board))) overlaps.push(`board/${pod.getAttribute('data-tracker-seat')}`);
      const plate = pod.querySelector('.tracker-seat-plate');
      const cards = pod.querySelector('.tracker-seat-cards');
      if (plate && cards && hits(rect(plate), rect(cards))) overlaps.push(`cards/name/${pod.getAttribute('data-tracker-seat')}`);
      const avatar = pod.querySelector('.tracker-seat-avatar > div');
      const holeCards = cards ? [...cards.querySelectorAll('[data-card-code], :scope > div:not(:has([data-card-code]))')] : [];
      const isFan = cards?.getAttribute('data-revealed') === 'false';
      holeCards.forEach((card, ci) => {
        if (!isFan && avatar && hits(rect(card), rect(avatar))) overlaps.push(`card/avatar/${pod.getAttribute('data-tracker-seat')}/${ci}`);
        holeCards.slice(ci + 1).forEach(other => {
          if (!isFan && hits(rect(card), rect(other))) overlaps.push(`card/card/${pod.getAttribute('data-tracker-seat')}`);
        });
      });
    });
    if (board) for (const bet of table.querySelectorAll('[data-tracker-bet]')) {
      if (hits(rect(bet), rect(board))) overlaps.push(`bet/board/${bet.getAttribute('data-tracker-bet')}`);
    }
    const out = pods.filter(pod => rect(pod).left < -1 || rect(pod).right > innerWidth + 1).map(pod => pod.getAttribute('data-tracker-seat'));
    return { orientation: table.getAttribute('data-tracker-table'), width: rect(table).width, height: rect(table).height, count: pods.length, overlaps, out, overflow: document.documentElement.scrollWidth - innerWidth };
  });
}

test.afterAll(() => { mkdirSync('shots', { recursive: true }); writeFileSync('shots/tracker-unified-metrics.json', JSON.stringify(metrics, null, 2)); });
for (const width of viewports) {
  test(`table surfaces at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [surface, url] of [
      ['input', '/__dev/tracker'],
      ['live', '/__dev/livefelt?fixture=showdown&seats=9&stress=1'],
      ['replay', '/__dev/livefelt?fixture=allin-sidepots&seats=9&wrap=console'],
    ]) {
      await page.goto(url);
      await expect(page.locator('[data-tracker-table]')).toBeVisible();
      await page.waitForTimeout(180);
      const result = await measure(page);
      metrics.push({ surface, viewport: width, ...result });
      await page.screenshot({ path: `shots/tracker-${surface}-${width}.png`, fullPage: true });
      expect.soft(result.count).toBe(9);
      expect.soft(result.out, `${surface} off-screen pods`).toEqual([]);
      expect.soft(result.overflow, `${surface} document overflow`).toBeLessThanOrEqual(1);
      expect.soft(result.overlaps, `${surface} overlapping pods/board`).toEqual([]);
    }
  });
}

test('viewer remembers deck and input remains four-color; all 52 assets load', async ({ page }) => {
  await page.goto('/__dev/livefelt?fixture=showdown&seats=9');
  await expect(page.locator('img[src^="/cards/four-color/"]').first()).toBeVisible();
  await page.getByRole('button', { name: /^(Kiểu cũ|Classic)$/ }).click();
  await expect(page.locator('img[src^="/cards/xcards/"]').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^(Kiểu cũ|Classic)$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/__dev/tracker');
  await expect(page.locator('img[src^="/cards/four-color/"]').first()).toBeVisible();
  expect(await page.locator('img[src^="/cards/xcards/"]').count()).toBe(0);
  await page.goto('/cards/four-color/index.html');
  expect(await page.locator('img').count()).toBe(52);
  expect(await page.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
});

test('mobile landscape and sparse physical seating', async ({ page }) => {
  for (const seats of [3, 6, 9]) {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(`/__dev/livefelt?fixture=allin-sidepots&seats=${seats}`);
    await expect(page.locator('[data-tracker-table="landscape"]')).toBeVisible();
    const result = await measure(page);
    metrics.push({ viewport: '844x390', seats, ...result });
    expect(result.overlaps).toEqual([]);
    expect(result.overflow).toBeLessThanOrEqual(1);
  }
});

test('input follows container width when rotating without a reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/__dev/tracker');
  await expect(page.locator('[data-tracker-table="portrait"]')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('[data-tracker-table="landscape"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-tracker-table="portrait"]')).toBeVisible();
});

test('nine committed stacks do not cover the board', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ['/__dev/tracker?allbets=1', '/__dev/livefelt?fixture=showdown&allbets=1&step=12']) {
      await page.goto(url);
      await expect(page.locator('[data-tracker-bet]')).toHaveCount(9);
      const result = await measure(page);
      metrics.push({ viewport: width, allbets: true, url, ...result });
      expect.soft(result.overlaps).toEqual([]);
      await page.screenshot({ path: `shots/tracker-allbets-${url.includes('livefelt') ? 'viewer' : 'input'}-${width}.png`, fullPage: true });
    }
  }
});

test('forced landscape on a phone contains all seat pods and keeps face-down cards fanned on avatars', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/__dev/livefelt?fixture=showdown&seats=9&orientation=landscape');
  const table = page.locator('[data-tracker-table="landscape"]');
  await expect(table.locator('[data-cat-khoi]')).toBeVisible();
  const layout = await table.evaluate(element => {
    const viewport = element.parentElement!.getBoundingClientRect();
    const contained = [...element.querySelectorAll('[data-tracker-seat]')].every(seat => {
      const rect = seat.getBoundingClientRect();
      return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1
        && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1;
    });
    return { contained, scrolls: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  expect(layout).toEqual({ contained: true, scrolls: false });
  await page.goto('/__dev/livefelt?fixture=showdown&seats=9&step=0');
  const fan = page.locator('.tracker-seat-cards[data-revealed="false"]').filter({ has: page.getByTestId('card-back') }).first();
  await expect(fan.locator('[data-testid="card-back"]')).toHaveCount(2);
  expect(await fan.evaluate(element => {
    const [first, second] = [...element.querySelectorAll('[data-testid="card-back"]')];
    const avatar = element.parentElement!.querySelector('.tracker-seat-medallion')!.getBoundingClientRect();
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    return getComputedStyle(first).getPropertyValue('--poker-card-bg-soft').trim() === '#ffffff'
      && Math.min(a.top, b.top) > avatar.top + avatar.height * .13
      && Math.min(a.top, b.top) < avatar.bottom
      && a.right > b.left
      && getComputedStyle(first).transform !== getComputedStyle(second).transform;
  })).toBe(true);
});

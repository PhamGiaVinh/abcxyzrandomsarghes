import { expect, test } from '@playwright/test';

test('dealer mode switch retains the hand and dismisses the mock mic proposal after a manual action', async ({ page }) => {
  await page.goto('/__dev/tracker');
  await page.getByRole('button', { name: 'Mic + tay' }).click();
  await page.getByRole('button', { name: 'Thử câu mẫu' }).click();
  await expect(page.getByText('Đang nghe · Ghế 5')).toBeVisible();
  await page.getByRole('button', { name: 'Kết thúc câu' }).click();
  const proposal = page.getByRole('button', { name: /^Xác nhận Ghế 5/ });
  await expect(proposal).toBeVisible();
  await page.getByRole('button', { name: /THEO.*2/ }).click();
  await expect(page.getByRole('button', { name: 'Hoàn tác mẫu' })).toBeVisible();
  await expect(proposal).toHaveCount(0);
  await page.getByRole('button', { name: 'Chỉ nhập tay' }).click();
  await expect(page.getByRole('status')).toContainText('Ghế 5');
  await page.getByRole('button', { name: 'Khán giả' }).click();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Hoàn tác mẫu|Thử câu mẫu/ })).toHaveCount(0);
  await page.getByLabel('Vòng chơi').selectOption('flop');
  await expect(page.locator('[data-card-code]')).toHaveCount(3);
});

test('landscape iPad keeps the tappable shot clock between the board and the lower seats', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 810 });
  await page.goto('/__dev/tracker?allbets=1');
  const felt = page.locator('[data-tracker-table]');
  const pause = felt.getByRole('button', { name: 'Tạm dừng', exact: true });
  await expect(pause).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const position = await pause.evaluate((button) => {
    const table = button.closest('[data-tracker-table]')!;
    const board = table.querySelector('[data-testid="board-cards"]')!.getBoundingClientRect();
    const clock = button.getBoundingClientRect();
    const clockLane = button.closest('.tracker-board-clock')!.getBoundingClientRect();
    const objects = table.querySelectorAll('[data-tracker-seat], [data-tracker-bet]');
    const obscured = [...objects].filter((obj) => {
      const box = obj.getBoundingClientRect();
      return Math.min(clockLane.right, box.right) - Math.max(clockLane.left, box.left) > 2
        && Math.min(clockLane.bottom, box.bottom) - Math.max(clockLane.top, box.top) > 2;
    }).map(el => el.outerHTML.slice(0, 100));
    return { gap: clock.top - board.bottom, centered: clock.right >= board.left && clock.left <= board.right, obscured };
  });
  expect(position.gap).toBeGreaterThanOrEqual(0);
  expect(position.gap).toBeLessThanOrEqual(36);
  expect(position.centered).toBe(true);
  expect(position.obscured).toEqual([]);
  await pause.click();
  await expect(felt.getByRole('button', { name: 'Tiếp tục', exact: true })).toBeVisible();
});

for (const width of [320, 390, 680, 768, 1024]) {
  test(`nine occupied seats, five cards and all nine chip stacks stay clear at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/__dev/tracker?allbets=1');
    for (const mode of ['Chỉ nhập tay', 'Mic + tay', 'Khán giả']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      const table = page.locator('[data-tracker-table]');
      await expect(table.locator('[data-tracker-bet]')).toHaveCount(9);
      await expect(table.locator('[data-tracker-seat]')).toHaveCount(9);
      await expect(table.locator('[data-testid="board-cards"] [data-card-code]')).toHaveCount(5);
      await page.evaluate(() => document.fonts.ready);
      const overlaps = await table.evaluate((felt) => {
        const conflicts: string[] = [];
        const seats = [...felt.querySelectorAll<HTMLElement>('[data-tracker-seat]')];
        const cards = [...felt.querySelectorAll<HTMLElement>('[data-testid="board-cards"] [data-card-code]')];
        const chips = [...felt.querySelectorAll<HTMLElement>('[data-tracker-bet]')];
        const hits = (a: HTMLElement, b: HTMLElement) => {
          const x = a.getBoundingClientRect();
          const y = b.getBoundingClientRect();
          return Math.min(x.right, y.right) - Math.max(x.left, y.left) > 2
            && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 2;
        };
        for (const [i, seat] of seats.entries()) for (const neighbor of seats.slice(i + 1)) {
          if (hits(seat, neighbor)) conflicts.push(`seat ${seat.dataset.trackerSeat} / seat ${neighbor.dataset.trackerSeat}`);
        }
        for (const chip of chips) for (const seat of seats) {
          if (hits(chip, seat)) conflicts.push(`bet ${chip.dataset.trackerBet} / seat ${seat.dataset.trackerSeat}`);
        }
        for (const card of cards) {
          for (const chip of chips) if (hits(card, chip)) conflicts.push(`card ${card.dataset.cardCode} / bet ${chip.dataset.trackerBet}`);
          for (const seat of seats) if (hits(card, seat)) conflicts.push(`card ${card.dataset.cardCode} / seat ${seat.dataset.trackerSeat}`);
        }
        return conflicts;
      });
      expect(overlaps, mode).toEqual([]);
    }
  });
}

test.describe('touch clock', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });
  test('a tap immediately after swiping pauses once, and reset starts thirty seconds', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP provides the touch gesture for this regression.');
    await page.goto('/__dev/tracker');
    const face = page.getByRole('button', { name: 'Tạm dừng', exact: true });
    await page.getByText('Cài đặt', { exact: true }).tap();
    await page.getByLabel('Vuốt trái').selectOption('15');
    await page.getByText('Cài đặt', { exact: true }).tap();
    const rect = (await face.boundingBox())!;
    const x = rect.x + rect.width - 8, y = rect.y + rect.height / 2;
    const touch = await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const distance of [15, 30, 55]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - distance, y }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('timer')).toHaveText('00:15');
    await face.tap();
    await expect(page.getByRole('button', { name: 'Tiếp tục', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reset', exact: true }).tap();
    await expect(page.getByRole('timer')).toHaveText('00:30');
    await expect(face).toBeVisible();
  });
});

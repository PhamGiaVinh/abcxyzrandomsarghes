import { expect, test } from "@playwright/test";

test.use({ video: "on", hasTouch: true, launchOptions: { args: ["--autoplay-policy=user-gesture-required"] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const bytes = new WeakMap<ArrayBuffer, string>();
    const decoded = new WeakMap<AudioBuffer, string>();
    const starts: { src: string; state: string; duration: number; peak: number }[] = [];
    Object.assign(window, { trackerAudioStarts: starts });
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const data = await arrayBuffer.call(this); bytes.set(data, this.url); return data;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (data: ArrayBuffer) {
      const result = await decode.call(this, data);
      decoded.set(result, bytes.get(data) ?? ""); return result;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      start.call(this, when, offset, duration);
      if (this.buffer && decoded.has(this.buffer)) {
        let peak = 0; for (const value of this.buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
        starts.push({ src: decoded.get(this.buffer)!, state: this.context.state, duration: this.buffer.duration, peak });
      }
    };
  });
});

for (const width of [390, 1440]) {
  test(`verified pots credit stacks and play the original cue at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/__dev/livefelt?fixture=verified-sidepots&play=1&autoplay=0&orientation=${width < 640 ? "portrait" : "landscape"}&wrap=console`);
    await page.getByTitle(/^(Phát|Play)$/).click();
    const main = page.getByTestId("felt-settlement-award-label-tom");
    await expect(main).toHaveText("+150 BB", { timeout: 20_000 });
    const mainAppearedAt = Date.now();
    await expect(page.getByTestId("felt-stack-tom")).toHaveText("150 BB");
    await expect(page.getByTestId("felt-stack-phil")).toHaveText("0 BB");
    if (width < 640) {
      await expect(page.getByTestId("felt-settlement-award-announcement")).toHaveClass("sr-only");
    }
    await expect.poll(() => page.evaluate(() => {
      const sounds = (window as unknown as { trackerAudioStarts: { src: string; state: string; duration: number; peak: number }[] }).trackerAudioStarts;
      return sounds.some(sound => sound.src.includes("pot-award-2531.mp3") && sound.state === "running" && sound.duration > 0.5 && sound.peak > 0.1);
    })).toBe(true);
    const cues = await page.evaluate(() => (window as unknown as { trackerAudioStarts: { src: string }[] }).trackerAudioStarts.map(sound => sound.src.split('/').at(-1)));
    expect(cues.filter(cue => cue === "showdown-2533.mp3")).toHaveLength(1);
    expect(cues.filter(cue => cue === "deal-flop-2534.mp3")).toHaveLength(1);
    expect(cues.filter(cue => cue === "deal-turn-river-2535.mp3")).toHaveLength(2);
    expect(cues.filter(cue => cue === "hand-ranking-2536.mp3")).toHaveLength(1);
    await page.screenshot({ path: `shots/award-main-${width}.png`, fullPage: true });
    const side = page.getByTestId("felt-settlement-award-label-phil");
    await expect(side).toHaveText("+50 BB");
    expect(Date.now() - mainAppearedAt).toBeGreaterThan(2_800);
    await expect(page.getByTestId("felt-stack-tom")).toHaveText("150 BB");
    await expect(page.getByTestId("felt-stack-phil")).toHaveText("50 BB");
    await expect.poll(() => page.evaluate(() => (window as unknown as { trackerAudioStarts: { src: string }[] }).trackerAudioStarts.filter(sound => sound.src.includes("pot-award-2531.mp3")).length)).toBe(2);
    await page.waitForTimeout(3_200);
    await expect(side).toBeVisible();
    await expect(page.locator('[data-testid^="felt-settlement-pot-"]')).toHaveCount(0);
    await page.screenshot({ path: `shots/award-side-${width}.png`, fullPage: true });
    const stack = await page.getByTestId("felt-stack-phil").boundingBox();
    const label = await side.boundingBox();
    expect(label!.y).toBeGreaterThanOrEqual(stack!.y + stack!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test("fold win credits only the pot, keeps cards hidden, and mute suppresses the cue", async ({ page }) => {
  await page.goto("/__dev/livefelt?fixture=verified-fold&play=1&autoplay=0&orientation=portrait");
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await page.getByTitle(/^(Phát|Play)$/).click();
  await expect(page.getByTestId("felt-settlement-award-label-phil")).toHaveText("+2 BB", { timeout: 15_000 });
  await expect(page.getByTestId("felt-stack-phil")).toHaveText("76 BB");
  await expect(page.locator('[data-testid="seat-holecards"] [data-card-code]')).toHaveCount(0);
  await expect(page.locator(".tracker-best-five-card")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { trackerAudioStarts: { src: string }[] }).trackerAudioStarts.filter(sound => sound.src.includes("pot-award-2531.mp3")).length)).toBe(0);
});

test("pausing during chip travel cancels the delayed winner cue", async ({ page }) => {
  await page.goto("/__dev/livefelt?fixture=verified-sidepots&play=1&autoplay=0&orientation=portrait");
  await page.getByTitle(/^(Phát|Play)$/).click();
  await page.getByTestId("felt-settlement-award-announcement").waitFor({ state: "attached", timeout: 20_000 });
  await page.getByTitle(/^(Tạm dừng|Pause)$/).click();
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => (window as unknown as { trackerAudioStarts: { src: string }[] }).trackerAudioStarts.filter(sound => sound.src.includes("pot-award-2531.mp3")).length)).toBe(0);
});

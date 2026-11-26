import { expect, test } from "@playwright/test";

const viewports = [
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1194, height: 834 },
  { width: 1440, height: 900 },
] as const;

test("mock Voice keeps Shadow local, then flows through Assist, correction and Viewer/Replay", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/__uat/tracker-voice");
  await page.getByRole("button", { name: "MOCK" }).click();

  await page.getByRole("button", { name: "Cho phép microphone" }).click();
  await expect(page.getByText("Microphone đã kết nối", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bắt đầu phiên test" }).click();
  await expect(page.getByTestId("connection-drop-count")).toHaveText("0");
  await expect(page.getByTestId("reconnect-count")).toHaveText("0");

  const transcript = page.getByRole("textbox", { name: "Mock transcript" });
  await transcript.fill("call");
  await page.getByRole("button", { name: "Phát final" }).click();
  await expect(page.getByText("Hãy đọc rõ Ghế đang tới lượt trước action.")).toBeVisible();
  await expect(page.getByTestId("canonical-action-count")).toHaveText("0");
  await transcript.fill("ghế 4 call");
  await page.getByRole("button", { name: "Phát final" }).click();
  await expect(page.getByText("Shadow hợp lệ, không gọi server và chưa ghi action.")).toBeVisible();
  await expect(page.getByTestId("validation-count")).toHaveText("0");

  await page.getByRole("button", { name: "assist" }).click();
  await transcript.fill("ghế 4 call");
  await page.getByRole("button", { name: "Phát final" }).click();
  await expect(page.getByText("Player A · call tới 100.000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận action" }).click();
  await expect(page.getByTestId("canonical-action-count")).toHaveText("1");
  await expect(page.getByTestId("viewer-replay-actions")).toContainText("Player A · call");

  await page.getByRole("button", { name: "Phát duplicate provider callback" }).click();
  await expect(page.getByTestId("validation-count")).toHaveText("2");
  await page.getByRole("button", { name: "Xác nhận action" }).click();
  await expect(page.getByTestId("canonical-action-count")).toHaveText("2");

  await transcript.fill("báo sai action");
  await page.getByRole("button", { name: "Phát final" }).click();
  await expect(page.getByText("Alert đã vào hàng đợi Floor.")).toBeVisible();
  await expect(page.getByTestId("floor-alert-count")).toHaveText("1");

  await transcript.fill("ghế 4 raise 200 nghìn");
  await page.getByRole("button", { name: "Phát final" }).click();
  await expect(page.getByText("1 transcript đang chờ Floor")).toBeVisible();
  await expect(page.getByTestId("canonical-action-count")).toHaveText("2");
  await page.getByRole("button", { name: "Kiểm tra lại sau khi Floor sửa" }).click();
  await page.getByRole("button", { name: "Xác nhận action" }).click();
  await expect(page.getByTestId("canonical-action-count")).toHaveText("3");
  await expect(page.getByTestId("viewer-replay-actions")).toContainText("raise tới 200.000");

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(pageErrors).toEqual([]);
});

test("mock Voice recovers fail-closed after an offline event", async ({ page }) => {
  await page.goto("/__uat/tracker-voice");
  await page.getByRole("button", { name: "MOCK" }).click();
  await page.getByRole("button", { name: "Cho phép microphone" }).click();
  await page.getByRole("button", { name: "Bắt đầu phiên test" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Thiết bị mất mạng. Voice đã dừng ghi action.")).toBeVisible();
  await expect(page.getByTestId("connection-drop-count")).toHaveText("1");
  await expect(page.getByTestId("canonical-action-count")).toHaveText("0");
  const reconnect = page.getByRole("button", { name: "Kết nối lại" }).last();
  await expect(reconnect).toBeVisible();
  await reconnect.click();
  await expect(page.getByTestId("reconnect-count")).toHaveText("1");
});

test("repaired call remains a proposal until explicit confirmation", async ({ page }) => {
  await page.goto("/__uat/tracker-voice");
  await page.getByRole("button", { name: "MOCK" }).click();
  await page.getByRole("button", { name: "Cho phép microphone" }).click();
  await page.getByRole("button", { name: "Bắt đầu phiên test" }).click();
  await page.getByRole("button", { name: "assist" }).click();
  await page.getByRole("textbox", { name: "Mock transcript" }).fill("fit 4 call");
  await page.getByRole("button", { name: "Phát final" }).click();

  await expect(page.getByText("Player A · call tới 100.000", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Xác nhận action" })).toBeVisible();
  await expect(page.getByTestId("canonical-action-count")).toHaveText("0");
});

test("mock call Floor creates only a local fixture alert", async ({ page }) => {
  await page.goto("/__uat/tracker-voice");
  await page.getByRole("button", { name: "MOCK" }).click();
  await page.getByRole("button", { name: "Cho phép microphone" }).click();
  await page.getByRole("button", { name: "Bắt đầu phiên test" }).click();
  await page.getByRole("button", { name: "assist" }).click();
  await page.getByRole("textbox", { name: "Mock transcript" }).fill("gọi floor");
  await page.getByRole("button", { name: "Phát final" }).click();

  await expect(page.getByText("Alert đã vào hàng đợi Floor.")).toBeVisible();
  await expect(page.getByTestId("floor-alert-count")).toHaveText("1");
  await expect(page.getByTestId("canonical-action-count")).toHaveText("0");
});

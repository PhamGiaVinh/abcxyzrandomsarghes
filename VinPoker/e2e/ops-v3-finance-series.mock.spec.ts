import { installOperationalDocument } from "./helpers/opsOperationalDocument";
import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000005";
const userId = "00000000-0000-4000-8000-000000000005";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwNSJ9.";

const operatorScope = [{
  club_id: clubId,
  can_owner: true,
  can_floor: false,
  can_cashier: false,
  can_tracker: false,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: false,
  can_fnb_server: false,
  can_fnb_kitchen: false,
}];

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
] as const;

async function installMockOpsSession(page: Page, requests: string[], malformedFinance = false) {
  await page.addInitScript(({ token, expiry, actor }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: token,
      refresh_token: "mock-refresh-token",
      expires_in: expiry - Math.floor(Date.now() / 1000),
      expires_at: expiry,
      token_type: "bearer",
      user: {
        id: actor,
        aud: "authenticated",
        role: "authenticated",
        email: "owner@example.test",
        app_metadata: {},
        user_metadata: {},
        identities: [],
        created_at: "2026-08-09T00:00:00.000Z",
      },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/auth/v1/user")) return json({ id: userId, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-08-09T00:00:00.000Z" });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(operatorScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "CODEX CONTROL TEST CLUB" }]);
    if (path.endsWith("/rpc/get_club_finance_summary")) {
      if (malformedFinance) return json({ revenue: { total: 0 } });
      return json({
        revenue: { total: 1_000_000, rake: 500_000, serviceFee: 100_000, stakingFees: 100_000, payoutFees: 100_000, fnb: 200_000 },
        cost: { payrollNet: 200_000, ptWagePaid: 50_000, fnbCogs: 40_000, compCogs: 10_000, clubExpenses: 100_000 },
        net: 600_000,
      });
    }
    if (path.endsWith("/rpc/get_club_series_events")) return json([{
      buy_in: 1_000_000,
      club_id: clubId,
      event_date: "2026-08-01T08:00:00.000Z",
      event_id: "20000000-0000-4000-8000-000000000005",
      event_name: "CODEX SERIES READ TEST",
      fee: 100_000,
      gtd: 100_000_000,
      prize_pool_actual: 80_000_000,
      reentries: 5,
      service_fee: 0,
      total_entries: 50,
      unique_entries: 45,
    }]);
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

async function expectResponsive(page: Page) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const undersizedTargets = await page.locator("button, a").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    })
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .filter((rect) => rect.width < 44 || rect.height < 44));
  expect(undersizedTargets).toEqual([]);
}

test("Finance renders only the server summary and stays responsive", async ({ page }) => {
  const requests: string[] = [];
  await installMockOpsSession(page, requests);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/ops/finance?club=${clubId}`);

  await expect(page.getByRole("heading", { name: "Tài chính & Đối soát" })).toBeVisible();
  await expect(page.getByText("1.000.000 ₫")).toBeVisible();
  await expect(page.getByText(/không hiển thị số 0 giả/u)).toBeVisible();
  await expect(page.locator('[data-ops-action="finance.refresh"]')).toBeVisible();
  await expectResponsive(page);
  expect([...new Set(requests.filter((request) => /^POST /u.test(request)))].sort()).toEqual([
    "POST /rest/v1/rpc/get_club_finance_summary",
    "POST /rest/v1/rpc/get_owner_tour_rake_live_v1",
    "POST /rest/v1/rpc/get_my_ops_capability_scope",
    "POST /rest/v1/rpc/get_my_ops_global_capability",
  ].sort());
});

test("malformed Finance response blocks without client table fallback", async ({ page }) => {
  const requests: string[] = [];
  await installMockOpsSession(page, requests, true);
  await page.goto(`/ops/finance?club=${clubId}`);

  await expect(page.getByText("Tài chính tạm khóa")).toBeVisible();
  await expect(page.getByText("FINANCE_SUMMARY_MALFORMED")).toBeVisible();
  const restReads = requests.filter((request) => request.startsWith("GET /rest/v1/") && !request.endsWith("/clubs"));
  expect(restReads).toEqual([]);
});

test("Series opens the full planning document after verifying owner scope", async ({ page }) => {
  const requests: string[] = []; await installMockOpsSession(page, requests);
  await installOperationalDocument(page, "/club/admin/series-intelligence");
  await page.goto('/ops/series?club=' + clubId + '&t=stale');
  await expect(page.getByRole("heading", { name: "Operational destination" })).toBeVisible();
  await expect(page).toHaveURL(/\/club\/admin\/series-intelligence$/u);
  expect(requests.filter(request => /^POST /u.test(request) && !request.includes("/rpc/get_my_ops_"))).toEqual([]);
});

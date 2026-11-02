import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const tournamentId = "20000000-0000-4000-8000-000000000001";
const gameTableId = "30000000-0000-4000-8000-000000000001";
const tournamentTableId = "31000000-0000-4000-8000-000000000001";
const tableSessionId = "32000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9.";
const mockUser = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "operator@example.test",
  app_metadata: {},
  user_metadata: {},
  identities: [],
  created_at: "2026-08-09T00:00:00.000Z",
};

const operatorScope = [{
  club_id: clubId,
  can_owner: true,
  can_floor: true,
  can_cashier: true,
  can_tracker: false,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: false,
  can_fnb_server: false,
  can_fnb_kitchen: false,
}];

const tournament = {
  id: tournamentId,
  club_id: clubId,
  name: "CODEX FLOOR WORKSPACE TEST",
  status: "live",
  start_time: "2026-08-09T08:00:00.000Z",
  buy_in: 1_000_000,
  starting_chips: 30_000,
  max_players: 90,
  current_players: 0,
  current_level: 1,
  duration_minutes: 0,
  prize_pool: 0,
  game_type: "nlh",
  description: null,
};

async function installMockOpsSession(page: Page, modeWrites: { rpc: string; payload: Record<string, unknown> }[] = []) {
  let pendingMode: { id: string; target_mode: string; blockers: string[] } | null = null;
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
        email: "operator@example.test",
        app_metadata: {},
        user_metadata: {},
        identities: [],
        created_at: "2026-08-09T00:00:00.000Z",
      },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/auth/v1/user")) return json(mockUser);
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(operatorScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.includes("/rpc/") && /floor_.*table_control_mode/u.test(path)
      && !path.endsWith("/floor_get_table_control_mode_request_v1")) {
      modeWrites.push({ rpc: path.split("/").at(-1)!, payload: request.postDataJSON() });
    }
    if (path.endsWith("/rpc/floor_get_table_control_mode_request_v1")) return json({ ok: true, request: pendingMode });
    if (path.endsWith("/rpc/floor_request_table_control_mode_v4")) {
      pendingMode = { id: request.postDataJSON().p_request_id, target_mode: request.postDataJSON().p_control_mode, blockers: ["active_hand"] };
      return json({ ok: true, outcome: "pending", request_id: pendingMode.id, blockers: pendingMode.blockers });
    }
    if (path.endsWith("/rpc/get_tournament_participation_counts_v1")) return json({
      tournament_id: tournamentId, average_stack: 40_000, prize_pool: 0,
      counts: { total_entries: 1, re_entries: 0, remaining: 1, seated: 1,
        waiting: 0, busted: 0, anomaly_entries: 0, anomaly_seats: 0,
        live_entry_stack: 40_000, seated_stack: 40_000, waiting_stack: 0 },
    });
    if (path.endsWith("/rpc/get_tournament_clock")) return json({
      tournament_id: tournamentId, remaining_seconds: 1200, is_running: false,
      current_level: { level_number: 1, small_blind: 100, big_blind: 200,
        ante: 200, duration_minutes: 20, is_break: false }, next_level: null,
    });
    if (path.endsWith("/rpc/get_tv_tournament_branding_v1")) return json({
      logo_url: null, brand_name: "HSOP TEST", background_url: null, layout: null,
    });
    if (path.endsWith("/rpc/get_club_table_inventory")) return json([{
      game_table_id: gameTableId,
      table_number: 5,
      table_name: "Bàn 5",
      operational_status: "available",
      availability_status: "in_use",
      table_session_id: tableSessionId,
      session_type: "tournament",
      control_mode: "manual",
      control_epoch: 1,
      revision: 7,
      tournament_id: tournamentId,
      tournament_table_id: tournamentTableId,
      tournament_table_status: "active",
      active_dealer_assignment_id: null,
    }]);
    if (path.endsWith("/rpc/get_floor_tournament_table_roster_v3")) return json([{
      tournament_id: tournamentId,
      tournament_table_id: tournamentTableId,
      game_table_id: gameTableId,
      table_number: 5,
      table_name: "Bàn 5",
      table_session_id: tableSessionId,
      session_revision: 7,
      control_mode: "manual",
      control_epoch: 1,
      tournament_table_status: "active",
      session_closed_at: null,
      active_dealer_assignment_id: null,
      seats: [{
        seat_number: 1,
        entry_id: "40000000-0000-4000-8000-000000000001",
        player_id: "50000000-0000-4000-8000-000000000001",
        display_name: "Người chơi tên dài để kiểm tra mobile",
        entry_no: 1,
        chip_count: 40_000,
        is_active: true,
        integrity_status: "valid",
      }],
    }]);
    if (path.endsWith("/rpc/get_floor_seatable_entries")) return json([]);
    if (path.endsWith("/rpc/get_floor_restorable_entries_v3")) return json([]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "HSOP TEST" }]);
    if (path.endsWith("/tournaments")) {
      const wantsObject = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
      return json(wantsObject ? tournament : [tournament]);
    }
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 411, height: 915 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
] as const;

test("canonical Floor workspace preserves club scope and stays responsive", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMockOpsSession(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/ops/floor/tournaments/${tournamentId}/screens?club=${clubId}`);

  await page.waitForTimeout(1_000);
  expect(pageErrors).toEqual([]);
  await expect(page.locator('[data-ops-action="floor.tournament.exit"]')).toBeVisible();
  await expect(page.locator('[data-ops-action="floor.screens.open_public_tv"]')).toBeVisible();
  await expect(page.locator('[data-ops-action="floor.screens.open_pairing"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/screens\\?club=${clubId}$`));

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
    .map((element) => ({ label: element.textContent?.trim(), rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .filter(({ rect }) => rect.width < 44 || rect.height < 44));
  expect(undersizedTargets).toEqual([]);
});

test("Floor V3 table sheet is compact, uses tournament-chip units and exposes focused mode control", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMockOpsSession(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ops/floor/tournaments/${tournamentId}/tables?club=${clubId}`);

  const tableCard = page.locator('[data-ops-action="floor.tables.open_roster"]');
  await expect(tableCard).toBeVisible();
  await expect(tableCard).toContainText("1/9");
  await tableCard.click();

  const modeButton = page.locator('[data-ops-action="floor.tables.open_v3_control_mode"]');
  await expect(modeButton).toBeVisible();
  await expect(page.getByText("40.000 · Lần tham gia 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/40\.000\s*₫/u)).toHaveCount(0);
  await modeButton.click();
  await expect(page.locator('[data-ops-action="floor.tables.open_control_mode_confirm"]')).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const sheet = page.getByRole("dialog");
    await expect.poll(() => sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.locator('[data-testid^="floor-seat-row-"]')).toHaveCount(9);
    const modeCards = page.getByRole("radio");
    for (const card of await modeCards.all()) {
      await expect.poll(() => card.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(240);
    }
    await page.screenshot({ path: `test-results/ops-responsive/floor-${viewport.width}.png` });
  }
  await modeButton.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/ops-responsive/floor-roster-390.png" });
  await page.locator('[data-testid="floor-seat-row-9"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-testid="floor-seat-row-9"]')).toBeInViewport();
  expect(pageErrors).toEqual([]);
});

test("Floor mode confirmation sends canonical session fences and displays pending without changing chips", async ({ page }) => {
  const modeWrites: { rpc: string; payload: Record<string, unknown> }[] = [];
  await installMockOpsSession(page, modeWrites);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/ops/floor/tournaments/${tournamentId}/tables?club=${clubId}`);
  await page.locator('[data-ops-action="floor.tables.open_roster"]').click();
  await page.locator('[data-ops-action="floor.tables.open_v3_control_mode"]').click();
  const tracker = page.getByTestId("floor-table-control-mode-tracker");
  await expect(tracker).toBeEnabled();
  await tracker.click();
  await page.getByTestId("floor-table-control-mode-save").click();
  await page.getByTestId("floor-table-control-mode-confirm").click();
  await expect(page.getByText("Đang chờ chuyển sang Live Tracker.", { exact: true })).toBeVisible();
  expect(modeWrites).toEqual([{ rpc: "floor_request_table_control_mode_v4", payload: {
    p_tournament_table_id: tournamentTableId, p_table_session_id: tableSessionId,
    p_control_mode: "tracker", p_expected_revision: 7, p_expected_epoch: 1,
    p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
  } }]);
  await expect(page.getByText("40.000 · Lần tham gia 1", { exact: true })).toBeVisible();
  await expect(page.getByTestId("floor-table-control-mode-save")).toBeDisabled();
});

test("Cashier production surface is read-only and selected-club bound", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const writeRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
      && !pathname.includes("/rpc/get_my_ops_")
    ) writeRequests.push(request.url());
  });
  await installMockOpsSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ops/cashier?club=${clubId}`);

  await page.waitForTimeout(1_000);
  expect(pageErrors).toEqual([]);
  await expect(page.getByRole("main").getByText("READ_ONLY", { exact: true })).toBeVisible();
  await expect(page.getByText(/OPS MONEY GATE B/u)).toBeVisible();
  await expect(page.locator('[data-ops-action="cashier.refresh"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(writeRequests.filter((url) => url.includes("/rest/v1/") || url.includes("/functions/v1/"))).toEqual([]);
});

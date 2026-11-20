import { installOperationalDocument } from "./helpers/opsOperationalDocument";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

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

test("Floor submits two consecutive exact busts and opens the empty-table confirmation", async ({ page }) => {
  test.skip(process.env.VITE_FLOOR_FAST_BUST_V1 !== "preview", "Requires the isolated fast-bust preview flags");
  await installMockOpsSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const native = process.env.FLOOR_BUST_BROWSER_DATABASE === "vinpoker_floor_bust_browser";
  const query = (sql: string, variables: Record<string, string> = {}) => {
    return execFileSync("psql", ["-XAtq", "-h", "127.0.0.1", "-p", "5432",
      "-U", "postgres", "-d", "vinpoker_floor_bust_browser", "-v", "ON_ERROR_STOP=1",
      ...Object.entries(variables).flatMap(([key, value]) => ["-v", `${key}=${value}`]),
    ], { input: sql, encoding: "utf8", timeout: 10_000 }).trim();
  };
  const authSql = "SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; SET ROLE authenticated;";
  const pair: { tour: string; table: string; session: string; seat: string; entry: string }[] | null = native
    ? JSON.parse(query("SELECT fast_bust_test.seed_pair();")) : null;
  const activeTour = pair?.[0].tour ?? tournamentId;
  const activeSession = pair?.[0].session ?? tableSessionId;
  if (pair) {
    await page.route("http://127.0.0.1:54321/rest/v1/tournaments?**", route => {
      const object = (route.request().headers().accept ?? "").includes("vnd.pgrst.object");
      const selected = { ...tournament, id: activeTour };
      return route.fulfill({ json: object ? selected : [selected] });
    });
  }
  let seats = [1, 2].map(number => ({ seat_number: number, seat_id: `seat-${number}`,
    seat_entry_id: `entry-${number}`, entry_id: `entry-${number}`, player_id: `player-${number}`,
    display_name: `Floor fixture player ${number}`, entry_no: 1, chip_count: 0,
    is_active: true, integrity_status: "valid" }));
  const submissions: unknown[] = [];
  await page.route("http://127.0.0.1:54321/rest/v1/rpc/get_floor_tournament_table_roster_v*", route => {
    if (pair) {
      const roster = JSON.parse(query(`${authSql}
        SELECT public.get_floor_tournament_table_roster_v7(:'tour'::uuid);`, { tour: activeTour }));
      for (const table of roster) for (const seat of table.seats) seat.display_name = `Floor fixture player ${seat.seat_number}`;
      return route.fulfill({ json: roster });
    }
    return route.fulfill({ json: [{
    tournament_id: tournamentId, tournament_table_id: tournamentTableId, game_table_id: gameTableId,
    table_number: 5, table_name: "Bàn 5", table_session_id: tableSessionId, session_revision: 7 + submissions.length,
    control_mode: "manual", control_epoch: 1, tournament_table_status: "active", session_closed_at: null,
    active_dealer_assignment_id: null, seats,
    }] });
  });
  await page.route("http://127.0.0.1:54321/rest/v1/rpc/floor_operator_bust_seat_v1", route => {
    const body = route.request().postDataJSON();
    submissions.push(body);
    if (pair) {
      const receipt = query(`${authSql}
        WITH input AS (SELECT :'body'::jsonb AS b)
        SELECT public.floor_operator_bust_seat_v1((b->>'p_tournament_id')::uuid,(b->>'p_tournament_table_id')::uuid,
          (b->>'p_table_session_id')::uuid,(b->>'p_seat_id')::uuid,(b->>'p_expected_player_id')::uuid,
          (b->>'p_expected_seat_number')::integer,(b->>'p_expected_seat_entry_id')::uuid,
          (b->>'p_expected_control_epoch')::bigint,(b->>'p_request_id')::uuid,b->>'p_reason') FROM input;`,
      { body: JSON.stringify(body) });
      return route.fulfill({ json: JSON.parse(receipt) });
    }
    seats = seats.filter(seat => seat.seat_id !== body.p_seat_id);
    return route.fulfill({ json: { ok: true, outcome: "busted", request_id: body.p_request_id,
      seat_id: body.p_seat_id, entry_id: body.p_expected_seat_entry_id, table_session_id: tableSessionId,
      payout_applied: false, revision: 7 + submissions.length } });
  });
  await page.goto(`/ops/floor/tournaments/${activeTour}/tables?club=${clubId}`);
  await page.locator('[data-ops-action="floor.tables.open_roster"]').click();
  const timings: { clickToReceiptMs: number; receiptToNextActionMs: number }[] = [];
  for (const number of [1, 2]) {
    const row = page.getByTestId(`floor-seat-row-${number}`);
    await expect(row).toContainText(`Floor fixture player ${number}`);
    await row.click();
    await page.getByRole("button", { name: "Loại khỏi giải", exact: true }).click();
    const response = page.waitForResponse(reply => new URL(reply.url()).pathname.endsWith("/floor_operator_bust_seat_v1"));
    const started = performance.now();
    await page.getByRole("button", { name: "Xác nhận loại", exact: true }).click();
    expect(await (await response).json()).toMatchObject({ ok: true, payout_applied: false });
    const received = performance.now();
    await expect(row).not.toContainText(`Floor fixture player ${number}`);
    const nextAction = number === 1 ? page.getByTestId("floor-seat-row-2")
      : page.getByRole("button", { name: "Đóng bàn trống", exact: true });
    await expect(nextAction).toBeEnabled();
    timings.push({ clickToReceiptMs: received - started, receiptToNextActionMs: performance.now() - received });
  }
  expect(submissions).toEqual([1, 2].map(number => expect.objectContaining({
    p_table_session_id: activeSession, p_seat_id: pair?.[number - 1].seat ?? `seat-${number}`,
    p_expected_seat_entry_id: pair?.[number - 1].entry ?? `entry-${number}`, p_expected_control_epoch: 1,
  })));
  await page.getByRole("button", { name: "Đóng bàn trống", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đóng bàn trống?" })).toBeVisible();
  if (pair) {
    expect(query(`SELECT count(*) FROM public.tournament_entries
      WHERE tournament_id=:'tour'::uuid AND status='busted' AND current_stack=0;`, { tour: activeTour })).toBe("2");
    console.log(JSON.stringify({ kind: "FLOOR_BUST_CHROMIUM_LOCAL_POSTGRES", samples: timings, qualification: false }));
  }
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

test("Cashier opens its operational document without a money mutation", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => { const path = new URL(request.url()).pathname;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !path.includes("/rpc/get_my_ops_")) writes.push(path);
  });
  await installMockOpsSession(page); await installOperationalDocument(page, "/cashier");
  await page.goto('/ops/cashier?club=' + clubId);
  await expect(page.getByRole("heading", { name: "Operational destination" })).toBeVisible();
  await expect(page).toHaveURL(/\/cashier$/u); expect(writes).toEqual([]);
});

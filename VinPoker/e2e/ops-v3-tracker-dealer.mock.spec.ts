import { installOperationalDocument } from "./helpers/opsOperationalDocument";
import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000003";
const tournamentId = "20000000-0000-4000-8000-000000000003";
const tableId = "30000000-0000-4000-8000-000000000003";
const dealerId = "40000000-0000-4000-8000-000000000003";
const userId = "00000000-0000-4000-8000-000000000003";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMyJ9.";

const operatorScope = [{
  club_id: clubId,
  can_owner: false,
  can_floor: false,
  can_cashier: false,
  can_tracker: true,
  can_dealer_control: true,
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

async function installMockOpsSession(page: Page) {
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
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/auth/v1/user")) return json({
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "operator@example.test",
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: "2026-08-09T00:00:00.000Z",
    });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(operatorScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/rpc/get_club_table_inventory")) return json([{
      game_table_id: tableId,
      table_number: 3,
      table_name: "Cash 3",
      operational_status: "available",
      availability_status: "in_use",
      table_session_id: "31000000-0000-4000-8000-000000000003",
      session_type: "cash",
      control_mode: "manual",
      control_epoch: 1,
      revision: 1,
      tournament_id: null,
      tournament_table_id: null,
      tournament_table_status: null,
      active_dealer_assignment_id: "50000000-0000-4000-8000-000000000003",
    }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "CODEX OPS TEST CLUB" }]);
    if (path.endsWith("/tournaments")) return json([{
      id: tournamentId,
      name: "CODEX TRACKER READ TEST",
      status: "live",
      start_time: "2026-08-09T08:00:00.000Z",
      current_players: 3,
      current_level: 2,
    }]);
    if (path.endsWith("/tournament_tables")) return json([{
      id: tableId,
      tournament_id: tournamentId,
      table_number: 3,
      table_name: "Bàn 3",
      status: "running",
      max_seats: 9,
    }]);
    if (path.endsWith("/tournament_seats")) return json([{ table_id: tableId }]);
    if (path.endsWith("/game_tables")) return json([{
      id: tableId,
      table_name: "Cash 3",
      table_type: "cash",
      status: "active",
    }]);
    if (path.endsWith("/dealers")) return json([{
      id: dealerId,
      full_name: "CODEX DEALER TEST",
      tier: "B",
    }]);
    if (path.endsWith("/dealer_assignments")) return json([{
      id: "50000000-0000-4000-8000-000000000003",
      table_id: tableId,
      dealer_id: dealerId,
      swing_due_at: "2026-08-09T09:00:00.000Z",
      status: "assigned",
      needs_replacement: false,
      assigned_at: "2026-08-09T08:30:00.000Z",
    }]);
    if (path.endsWith("/dealer_attendance")) return json([{
      dealer_id: dealerId,
      current_state: "assigned",
      check_in_time: "2026-08-09T08:00:00.000Z",
    }]);
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

for (const [entry, destination] of [["/ops/tracker", "/tracker"], ["/ops/dealer-swing", "/dealer-swing"]]) {
  test(entry + " opens its operational document after verifying club access", async ({ page }) => {
    const writes: string[] = [];
    page.on("request", request => { const path = new URL(request.url()).pathname;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !path.includes("/rpc/get_my_ops_")) writes.push(path);
    });
    await installMockOpsSession(page); await installOperationalDocument(page, destination);
    await page.goto(entry + "?club=" + clubId + "&t=stale#old");
    await expect(page.getByRole("heading", { name: "Operational destination" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(destination + "$")); expect(writes).toEqual([]);
  });
  test(entry + " rejects another club before any document transition", async ({ page }) => {
    await installMockOpsSession(page); await installOperationalDocument(page, destination);
    await page.goto(entry + "?club=99999999-9999-4999-8999-999999999999");
    await expect(page.getByRole("heading", { name: "Không có quyền vận hành" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operational destination" })).toHaveCount(0);
  });
}

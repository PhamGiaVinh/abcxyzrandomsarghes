import { installOperationalDocument } from "./helpers/opsOperationalDocument";
import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000004";
const tournamentId = "20000000-0000-4000-8000-000000000004";
const userId = "00000000-0000-4000-8000-000000000004";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwNCJ9.";
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
  can_owner: false,
  can_floor: false,
  can_cashier: false,
  can_tracker: false,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: true,
  can_marketer: true,
  can_fnb_cashier: true,
  can_fnb_server: true,
  can_fnb_kitchen: true,
}];

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
] as const;

async function installMockOpsSession(page: Page, observedRequests: string[]) {
  await page.addInitScript(({ token, expiry, user }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: token,
      refresh_token: "mock-refresh-token",
      expires_in: expiry - Math.floor(Date.now() / 1000),
      expires_at: expiry,
      token_type: "bearer",
      user,
    }));
  }, { token: mockJwt, expiry: futureExpiry, user: mockUser });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    observedRequests.push(`${request.method()} ${path}`);
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/auth/v1/user")) return json(mockUser);
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(operatorScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "CODEX SERVICE TEST CLUB" }]);
    if (path.endsWith("/tournaments")) return json([{
      id: tournamentId,
      name: "CODEX CHIP READ TEST",
      status: "live",
      start_time: "2026-08-09T08:00:00.000Z",
    }]);
    if (path.endsWith("/rpc/get_issued_chip_inventory")) return json({
      tournament_id: tournamentId,
      denominations: [{
        denomination_id: "30000000-0000-4000-8000-000000000004",
        value: 5_000,
        color: "red",
        issued_count_total: 90,
      }],
      total_value: 450_000,
      reconciliation_value: 450_000,
      reconciled: true,
    });
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

for (const [entry, destination] of [
  ["/ops/chip-ops", "/chip-ops"], ["/ops/fnb", "/fnb/hub"], ["/ops/fnb/counter", "/fnb"],
  ["/ops/fnb/serve", "/fnb/serve"], ["/ops/fnb/kitchen", "/fnb/kitchen"], ["/ops/fnb/admin", "/fnb/admin"], ["/ops/marketing", "/marketing"],
]) {
  test(entry + " opens its existing operational document without a mutation", async ({ page }) => {
    const observedRequests: string[] = [];
    await installMockOpsSession(page, observedRequests); await installOperationalDocument(page, destination);
    await page.goto(entry + "?club=" + clubId + "&t=" + tournamentId);
    await expect(page.getByRole("heading", { name: "Operational destination" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(destination + "$"));
    expect(observedRequests.filter(request => /^POST /u.test(request) && !request.includes("/rpc/get_my_ops_"))).toEqual([]);
  });
}

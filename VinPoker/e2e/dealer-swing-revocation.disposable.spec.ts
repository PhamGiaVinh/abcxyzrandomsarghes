import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const actor = "00000000-0000-0000-0000-000000000003";
const owner = "00000000-0000-0000-0000-000000000001";
const clubA = "00000000-0000-0000-0000-000000000010";
const clubB = "00000000-0000-0000-0000-000000000020";

function sql(statement: string) {
  return execFileSync("psql", ["-XqAt", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8", timeout: 5000 }).trim();
}

function actorRead(statement: string) {
  return JSON.parse(sql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub" = '${actor}'; ${statement}; ROLLBACK;`));
}

test("open Dealer Swing verifies revoked club scope on session refresh", async ({ page }) => {
  test.skip(process.env.LOCAL_R02_BROWSER !== "1", "Disposable CI PostgreSQL only");
  expect(sql("SELECT to_regclass('public.club_dealer_controls') IS NOT NULL")).toBe("t");
  const inviteId = sql(`SET ROLE service_role; SELECT invite_id FROM public.apply_club_operator_invite(
    '${owner}','${clubA}','${actor}','known.cashier@example.com','dealer_control',false,'not_required');`);
  expect(inviteId).toMatch(/^[a-f0-9-]{36}$/);
  const readDealer = () => actorRead(`SELECT coalesce(json_agg(id),'[]') FROM public.dealer_control_club_ids('${actor}') id`);
  const readFloor = () => actorRead("SELECT coalesce(json_agg(scope),'[]') FROM public.get_my_floor_operator_scope() scope");
  expect(readDealer()).toEqual([clubA]);
  expect(readFloor()).toEqual(expect.arrayContaining([expect.objectContaining({ club_id: clubB, can_cashier: true })]));

  const expiry = 4102444800;
  const user = { id: actor, aud: "authenticated", role: "authenticated", email: "known.cashier@example.com", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-08-09T00:00:00Z" };
  const session = (revision: number) => ({
    access_token: `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: expiry, iat: revision })).toString("base64url")}.`,
    expires_at: expiry, expires_in: 3600, refresh_token: "local-test-refresh", token_type: "bearer", user,
  });
  await page.addInitScript(value => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), session(1));
  const dealerResponses: string[][] = [];
  const requestPaths = new Set<string>();
  await page.route("http://127.0.0.1:54321/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    requestPaths.add(pathname);
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (pathname === "/auth/v1/user") return json(user);
    if (pathname === "/auth/v1/token") return json(session(2));
    if (pathname.endsWith("/rpc/dealer_control_club_ids")) {
      expect(route.request().postDataJSON()).toEqual({ _user_id: actor });
      const response = readDealer();
      dealerResponses.push(response);
      return json(response);
    }
    if (pathname.endsWith("/rpc/get_my_floor_operator_scope")) return json(readFloor());
    if (pathname.endsWith("/clubs")) {
      return json([{ id: clubA, name: "Dealer TEST A" }, { id: clubB, name: "Cashier TEST B" }]);
    }
    // Unrelated app reads have a synthetic empty response. No browser write reaches PostgreSQL.
    if (route.request().method() === "GET" || pathname.startsWith("/rest/v1/rpc/")) return json([]);
    return route.abort();
  });

  await page.goto("/dealer-swing");
  const swingTab = page.getByRole("tab", { name: "Dealer Swing", exact: true });
  try {
    await expect(swingTab).toBeVisible();
  } catch (error) {
    console.error(JSON.stringify({ path: new URL(page.url()).pathname,
      authForm: await page.getByText("Sign In", { exact: true }).count(),
      dashboardHeading: await page.getByText("DEALER SWING", { exact: true }).count(),
      scopeError: await page.getByText(/phạm vi CLB/).count(),
      requestPaths: [...requestPaths], dealerScopeReads: dealerResponses.length }));
    throw error;
  }
  expect(dealerResponses).toContainEqual([clubA]);

  sql(`SET ROLE service_role; SELECT * FROM public.revoke_club_operator_invite('${owner}','${inviteId}');`);
  expect(readDealer()).toEqual([]);
  expect(readFloor()).toEqual(expect.arrayContaining([expect.objectContaining({ club_id: clubB, can_cashier: true })]));

  await page.evaluate(async () => {
    const path = "/src/integrations/supabase/client.ts";
    const { supabase } = await import(/* @vite-ignore */ path);
    const { error } = await supabase.auth.refreshSession();
    if (error) throw error;
  });
  await expect(page.getByText("Bạn chưa được phân công CLB nào")).toBeVisible();
  await expect(swingTab).toHaveCount(0);
  expect(dealerResponses.at(-1)).toEqual([]);
});

import { assert, assertEquals } from "jsr:@std/assert@1";

// Real SDK + Zod + deployed entrypoint control flow. Only transport/env/serve
// are fixtures; no network permission, real credentials, database or server.
Deno.test("cashier lookup real SDK request and body contract", async (t) => {
  const actor = "00000000-0000-4000-8000-000000000001";
  const player = "00000000-0000-4000-8000-000000000002";
  const club = "00000000-0000-4000-8000-000000000003";
  const otherClub = "00000000-0000-4000-8000-000000000004";
  const originalFetch = globalThis.fetch;
  const originalServe = Object.getOwnPropertyDescriptor(Deno, "serve")!;
  const originalGet = Deno.env.get;
  const originalInterval = globalThis.setInterval;
  const intervals = new Set<ReturnType<typeof setInterval>>();
  let handler: (req: Request) => Promise<Response>;
  let fixture = { role: "cashier", dealClub: club, noDeals: false, failedPath: "", unauthorized: false };
  const requests: { path: string; query: URLSearchParams }[] = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = originalInterval(...args);
    intervals.add(id);
    return id;
  }) as typeof setInterval;
  Deno.env.get = (name) => ({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "TEST_ANON", SUPABASE_SERVICE_ROLE_KEY: "TEST_SERVICE" })[name];
  Object.defineProperty(Deno, "serve", { configurable: true, value: (callback: typeof handler) => { handler = callback; return {}; } });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assertEquals(url.origin, "http://127.0.0.1:54321");
    requests.push({ path: url.pathname, query: url.searchParams });
    if (url.pathname === fixture.failedPath) return json({ code: "XX000", message: "TEST unavailable" }, 503);
    if (url.pathname === "/auth/v1/user") {
      assertEquals(request.headers.get("authorization"), "Bearer TEST_TOKEN");
      return fixture.unauthorized ? json({ message: "Invalid JWT", code: "bad_jwt" }, 401) : json({ id: actor });
    }
    assertEquals(request.headers.get("authorization"), "Bearer TEST_SERVICE");
    if (url.pathname === "/rest/v1/user_roles") {
      assertEquals(url.searchParams.get("user_id"), `eq.${actor}`);
      return json([{ role: fixture.role }]);
    }
    if (url.pathname === "/rest/v1/rpc/cashier_club_ids") {
      assertEquals(request.method, "POST");
      assertEquals(await request.json(), { _user_id: actor });
      return json([club]);
    }
    if (url.pathname === "/rest/v1/staking_deals") {
      assertEquals(url.searchParams.get("player_id"), `eq.${player}`);
      assertEquals(url.searchParams.get("status"), "in.(listing,committing,committed,funded)");
      if (fixture.role !== "super_admin") assertEquals(url.searchParams.get("club_id"), `in.(${club})`);
      return json(fixture.noDeals || (fixture.role !== "super_admin" && fixture.dealClub !== club) ? [] : [{
        id: "deal-test", club_id: fixture.dealClub, player_id: player, status: "funded", buy_in_amount_vnd: 100000, percentage_sold: 50, filled_percent: 30,
      }]);
    }
    if (url.pathname === "/rest/v1/profiles") {
      assertEquals(url.searchParams.get("user_id"), `eq.${player}`);
      return json({ user_id: player, display_name: "TEST Player", phone: "TEST_PHONE", bank_account_number: "TEST_ACCOUNT" });
    }
    if (url.pathname === "/rest/v1/staking_purchases") {
      assertEquals(url.searchParams.get("deal_id"), "in.(deal-test)");
      return json([]);
    }
    throw new Error(`Unexpected fixture path ${url.pathname}`);
  };
  async function invoke(payload: unknown = { user_id: player }) {
    return await handler(new Request("https://test.invalid/cashier-lookup-player", {
      method: "POST", headers: { Authorization: "Bearer TEST_TOKEN", "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }));
  }
  const cleanupIntervals = () => { for (const id of intervals) clearInterval(id); intervals.clear(); };
  try {
    await import("./index.ts");
    assert(typeof handler! === "function");
    const run = async (name: string, setup: Partial<typeof fixture>, check: () => Promise<void>) => {
      await t.step(name, async () => {
        fixture = { role: "cashier", dealClub: club, noDeals: false, failedPath: "", unauthorized: false, ...setup };
        requests.length = 0;
        try { await check(); } finally { cleanupIntervals(); }
      });
    };
    await run("authorized deal uses exact caller, player and club filters before profile", {}, async () => {
      const response = await invoke(); const body = await response.json();
      assertEquals(response.status, 200); assertEquals(body.player.id, player);
      assertEquals(body.deals[0].remaining_vnd, 20000);
      assert(requests.findIndex(r => r.path.endsWith("staking_deals")) < requests.findIndex(r => r.path.endsWith("profiles")));
    });
    for (const setup of [{ noDeals: true }, { dealClub: otherClub }]) {
      await run(`no private profile read without scoped deal ${JSON.stringify(setup)}`, setup, async () => {
        const response = await invoke(); const body = await response.json();
        assertEquals(response.status, 200); assertEquals(body.player, null);
        assertEquals(requests.some(r => r.path.endsWith("profiles")), false);
      });
    }
    await run("superadmin keeps global lookup", { role: "super_admin", noDeals: true }, async () => {
      const response = await invoke(); assertEquals(response.status, 200);
      assertEquals((await response.json()).player.id, player);
    });
    await run("invalid token never issues privileged REST reads", { unauthorized: true }, async () => {
      const response = await invoke(); assertEquals(response.status, 401); await response.body?.cancel();
      assertEquals(requests.some(r => r.path.startsWith("/rest/")), false);
    });
    await run("real Zod rejects malformed UUID before profile/deal lookup", {}, async () => {
      const response = await invoke({ user_id: "not-a-uuid" }); assertEquals(response.status, 400); await response.body?.cancel();
      assertEquals(requests.some(r => r.path.endsWith("profiles") || r.path.endsWith("staking_deals")), false);
    });
    await run("RPC failure does not become missing club permission", { failedPath: "/rest/v1/rpc/cashier_club_ids" }, async () => {
      const response = await invoke(); assertEquals(response.status, 500);
      assertEquals((await response.json()).error, "Cashier scope unavailable");
      assertEquals(requests.some(r => r.path.endsWith("profiles")), false);
    });
  } finally {
    cleanupIntervals();
    globalThis.fetch = originalFetch; Object.defineProperty(Deno, "serve", originalServe); Deno.env.get = originalGet; globalThis.setInterval = originalInterval;
  }
});

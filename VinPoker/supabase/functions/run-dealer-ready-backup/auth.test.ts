import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("backup HTTP handler rejects untrusted requests before privileged client construction", async () => {
  const oldServe = Deno.serve;
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldInternal = Deno.env.get("PROCESS_SWING_INTERNAL_SECRET");
  const oldFetch = globalThis.fetch;
  let handler: (req: Request) => Promise<Response>;
  // Capture the real deployed handler without binding a port or creating a backend client.
  Object.defineProperty(Deno, "serve", { configurable: true, value: (fn: typeof handler) => { handler = fn; } });
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "backup-handler-test-fixture");
  Deno.env.set("SUPABASE_URL", "");
  Deno.env.delete("PROCESS_SWING_INTERNAL_SECRET");
  try {
    await import("./index.ts");
    for (const token of ["anything", "public-anon-fixture", "browser-user-fixture"]) {
      const response = await handler!(new Request("https://worker.invalid", {
        method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}",
      }));
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { error: "internal_auth_denied" });
    }
    const methodResponse = await handler!(new Request("https://worker.invalid", { method: "GET" }));
    assertEquals(methodResponse.status, 405);
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    const response = await handler!(new Request("https://worker.invalid", { method: "POST" }));
    assertEquals(response.status, 503);

    // Real handler + real Supabase request construction, with deterministic transport doubles.
    // No production writes or network permission; assert mutation calls, not merely response text.
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "backup-handler-test-fixture");
    Deno.env.set("SUPABASE_URL", "https://backend.invalid");
    const club = "00000000-0000-4000-8000-000000000001";
    const table = "00000000-0000-4000-8000-000000000002";
    const session = "00000000-0000-4000-8000-000000000003";
    const attendance = "00000000-0000-4000-8000-000000000004";
    for (const scenario of ["off", "settings_error", "inventory_error", "lock_error", "locked", "planner_error", "overdue_error", "unknown_outcome", "success", "tour_policy", "cash_policy", "policy_error", "policy_invalid", "wrong_verify", "malformed_rest"]) {
      const calls: URL[] = [];
      globalThis.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        assertEquals(url.origin, "https://backend.invalid");
        calls.push(url);
        const route = url.pathname.split("/").at(-1);
        const reply = (data: unknown, status = 200, headers = {}) => Promise.resolve(new Response(
          JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } },
        ));
        if (route === "dealer_attendance" && init?.method === "HEAD") {
          return Promise.resolve(new Response(null, { headers: { "content-range": "0-0/1" } }));
        }
        if (route === "club_settings") return scenario === "settings_error"
          ? reply({ message: "fixture error" }, 503) : reply([{ auto_swing_enabled: scenario !== "off" }]);
        if (route === "get_dealer_operational_tables_v1") return scenario === "inventory_error"
          ? reply({ message: "fixture error" }, 503)
          : reply([{ id: table, table_session_id: session, table_type: scenario==='tour_policy'?'tournament':'cash',tournament_id:scenario==='tour_policy'?club:null, table_name: "TEST" }]);
        if (route === "try_acquire_cron_lock") return scenario === "lock_error"
          ? reply({ message: "fixture error" }, 503) : reply(scenario !== "locked");
        if (route === "swing_config") {
          if(url.searchParams.get('select')==='break_duration_minutes,min_inter_swing_rest_minutes'){
            assertEquals(url.searchParams.get('table_type'),scenario==='tour_policy'?'eq.tournament':'eq.cash');
            if(scenario==='policy_error')return reply({message:'fixture'},503);
            if(scenario==='policy_invalid')return reply([{break_duration_minutes:'20',min_inter_swing_rest_minutes:15}]);
            return reply(scenario==='tour_policy'?[]:[{break_duration_minutes:scenario==='cash_policy'?20:15,min_inter_swing_rest_minutes:15}]);
          }
          return scenario === "planner_error" ? reply({ message: "fixture error" }, 503) : reply([{ rotation_planner_enabled: false }]);
        }
        if (route === "dealer_attendance") {
          assertEquals(url.searchParams.get("dealers.club_id"), `eq.${club}`);
          assertEquals(url.searchParams.get("check_out_time"), "is.null");
          assertEquals(url.searchParams.get("status"), "eq.checked_in");
          return reply([{ id: attendance, dealer_id: "dealer-fixture" }]);
        }
        if (route === "atomic_dealer_ready_check") return reply({ verified: true, attendance_id:scenario==='wrong_verify'?club:attendance,rest_threshold_min: 20, rest_min: scenario==='malformed_rest'?null:15 });
        if (route === "dealer_assignments") {
          assertEquals(url.searchParams.get("table_id"), `in.(${table})`);
          return scenario === "overdue_error" ? reply({ message: "fixture error" }, 503)
            : reply([{ id: "assignment-fixture", version: 1, table_id: table, table_session_id: session }]);
        }
        if (route === "worker_perform_swing") {
          const intent = JSON.parse(String(init?.body));
          assertEquals(intent.p_table_session_id, session);
          assertEquals(intent.p_expected_version, 1);
          assertEquals(intent.p_next_attendance_id, attendance);
          assertEquals(intent.p_rest_deficit_minutes,scenario==='cash_policy'?5:0);
          return reply({ outcome: scenario === "unknown_outcome" ? "unknown" : "swung" });
        }
        if (route === "release_cron_lock") return reply(true);
        if (route === "cron_metrics") return reply(null, 201);
        throw new Error(`Unexpected fixture route ${route}`);
      };
      const result = await handler!(new Request("https://worker.invalid", { method: "POST",
        headers: { authorization: "Bearer backup-handler-test-fixture", "content-type": "application/json" },
        body: JSON.stringify({ club_id: club }),
      }));
      const shouldFail = scenario.endsWith("_error") || ["unknown_outcome","policy_invalid","wrong_verify","malformed_rest"].includes(scenario);
      assertEquals(result.status, shouldFail ? 500 : 200, scenario);
      assertEquals(calls.filter((url) => url.pathname.endsWith("/worker_perform_swing")).length,
        ["unknown_outcome", "success","tour_policy","cash_policy"].includes(scenario) ? 1 : 0, scenario);
      if (scenario === "off") assertEquals(calls.some((url) => url.pathname.endsWith("/get_dealer_operational_tables_v1")), false);
      await result.json();
    }
  } finally {
    globalThis.fetch = oldFetch;
    Object.defineProperty(Deno, "serve", { configurable: true, value: oldServe });
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldInternal === undefined) Deno.env.delete("PROCESS_SWING_INTERNAL_SECRET");
    else Deno.env.set("PROCESS_SWING_INTERNAL_SECRET", oldInternal);
  }
});

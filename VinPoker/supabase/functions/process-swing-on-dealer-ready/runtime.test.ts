import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("ready trigger honors OFF, verified inventory and exact-session commit", async () => {
  const oldServe = Deno.serve;
  const oldFetch = globalThis.fetch;
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DEALER_TRIGGER_INTERNAL_SECRET", "PROCESS_SWING_INTERNAL_SECRET"];
  const previous = names.map((name) => Deno.env.get(name));
  let handler: (req: Request) => Promise<Response>;
  Object.defineProperty(Deno, "serve", { configurable: true, value: (fn: typeof handler) => { handler = fn; } });
  Deno.env.set(names[0], "https://backend.invalid");
  Deno.env.set(names[1], "ready-service-fixture");
  Deno.env.set(names[2], "ready-internal-fixture");
  Deno.env.set(names[3], "ready-worker-fixture");
  const club = "00000000-0000-4000-8000-000000000001";
  const attendance = "00000000-0000-4000-8000-000000000002";
  const table = "00000000-0000-4000-8000-000000000003";
  const session = "00000000-0000-4000-8000-000000000004";
  try {
    await import("./index.ts");
    globalThis.fetch = () => { throw new Error("unauthenticated request reached privileged backend"); };
    for (const token of ["anon-fixture", "browser-fixture", "", "ready-worker-fixture-wrong"]) {
      const denied = await handler!(new Request("https://worker.invalid", { method: "POST",
        headers: { authorization: `Bearer ${token}`, "x-idempotency-key": "denied_fixture" },
        body: JSON.stringify({ club_id: club, attendance_id: attendance }),
      }));
      assertEquals(denied.status, 401);
      await denied.json();
    }
    for (const credential of ["header", "worker", "service"]) {
    for (const scenario of ["off", "settings_error", "no_table", "eligibility_error", "eligibility_denied", "planner_error", "planner_on", "unknown", "success", "tour_policy", "cash_policy", "policy_error", "policy_invalid", "wrong_verify", "malformed_rest"]) {
      let mutations = 0;
      globalThis.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        assertEquals(url.origin, "https://backend.invalid");
        const route = url.pathname.split("/").at(-1);
        const reply = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {
          status, headers: { "content-type": "application/json" },
        }));
        if (route === "club_settings") return scenario === "settings_error" ? reply({ message: "fixture" }, 503)
          : reply([{ auto_swing_enabled: scenario !== "off" }]);
        if (route === "get_dealer_operational_tables_v1") return reply(scenario === "no_table" ? []
          : [{ id: table, table_session_id: session, table_type: scenario==='tour_policy'?'tournament':'cash', tournament_id:scenario==='tour_policy'?club:null, table_name: "TEST" }]);
        if (route === "atomic_dealer_ready_check") return reply({ attendance_id: scenario==='wrong_verify'?club:attendance, rest_threshold_min: 20, rest_min: scenario==='malformed_rest'?null:15 });
        if (route === "get_dealer_pool_eligible_attendance_v1") return scenario==='eligibility_error'
          ? reply({message:'fixture'},503):reply(scenario==='eligibility_denied'?[]:[{attendance_id:attendance}]);
        if (route === "swing_config") {
          if(url.searchParams.get('select')==='break_duration_minutes,min_inter_swing_rest_minutes'){
            assertEquals(url.searchParams.get('table_type'),scenario==='tour_policy'?'eq.tournament':'eq.cash');
            if(scenario==='policy_error')return reply({message:'fixture'},503);
            if(scenario==='policy_invalid')return reply([{break_duration_minutes:'20',min_inter_swing_rest_minutes:15}]);
            return reply(scenario==='tour_policy'?[]:[{break_duration_minutes:scenario==='cash_policy'?20:15,min_inter_swing_rest_minutes:15}]);
          }
          return scenario === "planner_error" ? reply({ message: "fixture" }, 503)
            : reply([{ rotation_planner_enabled: scenario === "planner_on" }]);
        }
        if (route === 'tournaments') return reply([{swing_duration_minutes:30}]);
        if (route === "swing_configs") return reply([]);
        if (route === "dealer_assignments") {
          assertEquals(url.searchParams.get("table_id"), `in.(${table})`);
          return reply([{ id: "assignment-fixture", version: 1, table_id: table, table_session_id: session }]);
        }
        if (route === "worker_perform_swing") {
          const intent = JSON.parse(String(init?.body));
          assertEquals(intent.p_table_session_id, session);
          assertEquals(intent.p_expected_version, 1);
          assertEquals(intent.p_next_attendance_id, attendance);
          assertEquals(intent.p_rest_deficit_minutes,scenario==='cash_policy'?5:0);
          mutations++;
          return reply({ outcome: scenario === "unknown" ? "unrecognized" : "swung", rest_deficit_minutes:0 });
        }
        if (route === "cron_metrics") return reply(null, 201);
        throw new Error(`unexpected fixture route ${route}`);
      };
      const response = await handler!(new Request("https://worker.invalid", { method: "POST",
        headers: { ...(credential === "header"
          ? { "x-vinpoker-internal-secret": "ready-internal-fixture" }
          : { authorization: `Bearer ${credential === "worker" ? "ready-worker-fixture" : "ready-service-fixture"}` }),
          "x-idempotency-key": `ready_${credential}_${scenario}` },
        body: JSON.stringify({ club_id: club, attendance_id: attendance }),
      }));
      assertEquals(response.status, scenario.endsWith("_error")||scenario==='policy_invalid' ? 503 : ["unknown","wrong_verify","malformed_rest"].includes(scenario) ? 500 : 200, scenario);
      assertEquals(mutations, ["unknown", "success","tour_policy","cash_policy"].includes(scenario) ? 1 : 0, scenario);
      await response.json();
    }
    }
  } finally {
    globalThis.fetch = oldFetch;
    Object.defineProperty(Deno, "serve", { configurable: true, value: oldServe });
    names.forEach((name, index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!));
  }
});

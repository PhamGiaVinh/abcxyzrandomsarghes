import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeHistoryWorker } from "./historyWorkerAuth.ts";
import { requireHistoryCanaryScope } from "./historyWorkerPolicy.ts";

const request = (token?: string) => new Request("https://example.invalid", {
  headers: token === undefined ? {} : { Authorization: token },
});

Deno.test("server-owned canary allowlist rejects absent, malformed, broad and foreign scopes", () => {
  const hand = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  requireHistoryCanaryScope([hand], JSON.stringify([hand]));
  for (const configured of [undefined, "null", "[]", "not-json", JSON.stringify([hand,hand]),
    JSON.stringify([hand,other,"00000000-0000-4000-8000-000000000003","00000000-0000-4000-8000-000000000004"])]) {
    let message = "";
    try { requireHistoryCanaryScope([hand], configured); } catch (error) { message = (error as Error).message; }
    assertEquals(message,"canary_scope_unavailable");
  }
  let message = "";
  try { requireHistoryCanaryScope([other],JSON.stringify([hand])); } catch (error) { message = (error as Error).message; }
  assertEquals(message,"hand_out_of_scope");
});

Deno.test("History deployment config permits custom bearer authentication at both handlers", async () => {
  const config = await Deno.readTextFile(new URL("../../../config.toml", import.meta.url));
  for (const name of ["tournament-historical-settlement-worker", "tournament-historical-settlement-dispatcher"]) {
    const section = config.split(`[functions.${name}]`)[1]?.split("[")[0];
    assertEquals(typeof section, "string", `${name} must have an explicit deployment policy`);
    assertEquals(/^verify_jwt\s*=\s*false\s*$/m.test(section ?? ""), true,
      `${name} uses constant-time handler authentication, not a user JWT`);
  }
});

Deno.test("history canary credential is scoped while legacy service invocation stays compatible", () => {
  assertEquals(authorizeHistoryWorker(request("Bearer canary-test"), "service-test", "canary-test"), { ok: true, scopedOnly: true });
  assertEquals(authorizeHistoryWorker(request("Bearer service-test"), "service-test", "canary-test"), { ok: true, scopedOnly: false });
});

Deno.test("history denies absent, malformed, wrong and unconfigured credentials", () => {
  for (const token of [undefined, "", "canary-test", "bearer canary-test", "Bearer outsider-test"]) {
    assertEquals(authorizeHistoryWorker(request(token), "service-test", "canary-test"), { ok: false });
  }
  assertEquals(authorizeHistoryWorker(request("Bearer service-test"), undefined, undefined), { ok: false });
});

Deno.test("matching both credentials still keeps canary scope", () => {
  assertEquals(authorizeHistoryWorker(request("Bearer same-test"), "same-test", "same-test"), { ok: true, scopedOnly: true });
});

Deno.test("worker and dispatcher reject unscoped canary before claim or forwarding", async () => {
  for (const entrypoint of ["tournament-historical-settlement-worker", "tournament-historical-settlement-dispatcher"]) {
    const source = await Deno.readTextFile(new URL(`../../${entrypoint}/index.ts`, import.meta.url));
    const scopeGuard = source.indexOf("authority.scopedOnly && !handIds");
    const effect = source.indexOf(entrypoint.endsWith("-worker") ? "const service = createClient" : "const response = await fetch");
    assertEquals(scopeGuard > 0 && effect > scopeGuard, true);
  }
  const dispatcher = await Deno.readTextFile(new URL("../../tournament-historical-settlement-dispatcher/index.ts", import.meta.url));
  assertEquals(dispatcher.includes("authority.scopedOnly ? canarySecret : serviceKey"), true);
});

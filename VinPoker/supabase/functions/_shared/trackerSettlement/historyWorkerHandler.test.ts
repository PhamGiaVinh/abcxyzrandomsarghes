import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.224.0/testing/mock.ts";

type Handler = (request: Request) => Response | Promise<Response>;
const handId = "8950a3d7-6119-49b9-9dc3-e2328dc9b444";
const environment: Record<string, string> = {
  TRACKER_HISTORY_COMPLETION_WORKER_ENABLED: "true",
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-test",
  TRACKER_HISTORY_CANARY_INTERNAL_SECRET: "canary-test",
};

Deno.test("actual History handlers enforce scoped canary and dispatcher preserves it", async () => {
  const env = stub(Deno.env, "get", (name: string) => environment[name]);
  let handler: Handler | undefined;
  const serve = stub(Deno, "serve", ((callback: Handler) => { handler = callback; }) as typeof Deno.serve);
  let networkCalls = 0;
  let forwarded: { authorization: string | null; body: unknown } | undefined;
  const network = stub(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    networkCalls++;
    forwarded = {
      authorization: new Headers(init?.headers).get("Authorization"),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(JSON.stringify({ ok: true, claimed: 1 }), { status: 200 });
  });
  const call = (token: string, body: unknown) => handler!(new Request("https://example.invalid", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  try {
    for (const entrypoint of ["tournament-historical-settlement-worker", "tournament-historical-settlement-dispatcher"]) {
      await import(new URL(`../../${entrypoint}/index.ts`, import.meta.url).href);
      assertEquals(typeof handler, "function");
      // Without gateway JWT enforcement, ordinary/malformed bearers still must
      // fail at the handler before any service client call or forwarding.
      for (const token of ["outsider-test", "", "eyJhbGciOiJIUzI1NiJ9.user-fixture.signature-fixture"]) {
        const denied = await call(token, { hand_ids: [handId], limit: 1 });
        assertEquals(denied.status, 401);
        await denied.json();
      }
      const absent = await handler!(new Request("https://example.invalid", {
        method: "POST", body: JSON.stringify({ hand_ids: [handId], limit: 1 }),
      }));
      assertEquals(absent.status, 401);
      await absent.json();
      delete environment.TRACKER_HISTORY_CANARY_INTERNAL_SECRET;
      const unconfigured = await call("canary-test", { hand_ids: [handId], limit: 1 });
      assertEquals(unconfigured.status, 401);
      await unconfigured.json();
      environment.TRACKER_HISTORY_CANARY_INTERNAL_SECRET = "canary-test";
      const unscoped = await call("canary-test", { limit: 1 });
      assertEquals(unscoped.status, 400);
      assertEquals((await unscoped.json()).code, "hand_scope_required");
      assertEquals(networkCalls, 0);
    }
    const valid = await call("canary-test", { hand_ids: [handId], limit: 1 });
    assertEquals(valid.status, 200);
    assertEquals(networkCalls, 1);
    assertEquals(forwarded, { authorization: "Bearer canary-test", body: { limit: 1, hand_ids: [handId] } });
    environment.TRACKER_HISTORY_COMPLETION_WORKER_ENABLED = "false";
    const disabled = await call("canary-test", { hand_ids: [handId], limit: 1 });
    assertEquals(disabled.status, 404);
    assertEquals(networkCalls, 1);
  } finally {
    network.restore(); serve.restore(); env.restore();
  }
});

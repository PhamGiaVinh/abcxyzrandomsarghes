import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { PGHOST, PGPORT, PGDATABASE, RUNNER_TEMP, POSTGREST_TEST_BIN } = process.env;
assert.equal(PGHOST, "127.0.0.1");
assert.equal(PGPORT, "5432");
assert.equal(PGDATABASE, "vinpoker_ops_fnb_browser");
assert.ok(RUNNER_TEMP && POSTGREST_TEST_BIN?.startsWith(RUNNER_TEMP + "/"));
const ids = Object.fromEntries(["owner", "club", "tour", "other", "session", "tracked", "menu", "ingredient"]
  .map(name => [name, randomUUID()]));
function sql(input) {
  const variables = Object.entries(ids).flatMap(([key, value]) => ["-v", `${key}=${value}`]);
  const result = spawnSync("psql", ["-w", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", ...variables], { input, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
sql(`DO $$ BEGIN
  ASSERT current_database() = 'vinpoker_ops_fnb_browser';
  ASSERT NOT EXISTS (SELECT 1 FROM public.clubs);
  ASSERT to_regclass('floor_private.fnb_order_tour_attribution_v1') IS NULL;
END $$;`);
sql(readFileSync("supabase/pending-migrations/20261120184849_fnb_order_tour_attribution_candidate_v1.sql", "utf8"));
sql(`BEGIN;
${readFileSync("e2e/tour-fnb-attribution-fixture.sql", "utf8")}
CREATE ROLE tour_fnb_browser_authenticator LOGIN NOINHERIT;
GRANT anon, authenticated TO tour_fnb_browser_authenticator;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid
$fn$;
COMMIT;`);
const table = sql("SELECT id FROM public.game_tables WHERE club_id=:'club' AND table_number=1;");
assert.match(table, /^[a-f0-9-]{36}$/);

const restUrl = "http://127.0.0.1:55469";
const frontendUrl = "http://127.0.0.1:55470";
const secret = randomBytes(48).toString("hex");
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const unsigned = encode({ alg: "HS256", typ: "JWT" }) + "." +
  encode({ role: "authenticated", sub: ids.owner, exp: Math.floor(Date.now() / 1000) + 300 });
const jwt = unsigned + "." + createHmac("sha256", secret).update(unsigned).digest("base64url");
const services = [];
const start = (command, args, env) => {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
  services.push(child);
  return child;
};
async function ready(child, url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Isolated service not ready");
}
async function rpc(name, body, owner = true) {
  const response = await fetch(restUrl + "/rpc/" + name, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(owner ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${name}: ${result.code ?? "unexpected HTTP status"}`);
  return result;
}
try {
  const rest = start(POSTGREST_TEST_BIN, [], {
    PGRST_DB_URI: `postgres://tour_fnb_browser_authenticator@127.0.0.1:5432/${PGDATABASE}`,
    PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_DB_CONFIG: "false",
    PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: "127.0.0.1", PGRST_SERVER_PORT: "55469",
  });
  await ready(rest, restUrl);
  const qr = await rpc("fnb_issue_table_qr_token", { p_club_id: ids.club, p_table_ref: table, p_label: "TEST table" });
  assert.equal(qr.status, "ok");
  const shift = await rpc("fnb_open_shift_v2", {
    p_club_id: ids.club, p_opening_float_vnd: 0, p_client_request_id: randomUUID(), p_expected_actor: ids.owner,
  });
  assert.equal(shift.error, undefined);
  const order = await rpc("fnb_guest_create_order", {
    p_token: qr.token, p_seat: 1, p_customer_name: "TEST guest",
    p_lines: [{ menu_item_id: ids.menu, qty: 1 }], p_payment_method: "cash", p_client_request_id: randomUUID(),
  }, false);
  assert.match(order.order_id, /^[a-f0-9-]{36}$/);
  const payment = await rpc("fnb_mark_paid", { p_order_id: order.order_id, p_client_request_id: randomUUID() });
  assert.equal(payment.status, "ok");
  const fixturePath = join(RUNNER_TEMP, "tour-fnb-browser-private.json");
  writeFileSync(fixturePath, JSON.stringify({ clubId: ids.club, tourId: ids.tour, otherTourId: ids.other, restUrl, jwt }), { mode: 0o600, flag: "wx" });
  const frontend = start(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "55470", "--strictPort"], {
    VITE_TOUR_FNB_ATTRIBUTION: "true",
  });
  await ready(frontend, frontendUrl);
  const browser = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "e2e/tour-fnb-attribution-real.spec.ts", "--project=chromium"], {
    stdio: "inherit", env: { ...process.env, LOCAL_TOUR_FNB_BROWSER_FIXTURE: fixturePath, PLAYWRIGHT_BASE_URL: frontendUrl },
  });
  assert.ifError(browser.error);
  assert.equal(browser.status, 0);
} finally {
  for (const service of services.reverse()) service.kill("SIGTERM");
}

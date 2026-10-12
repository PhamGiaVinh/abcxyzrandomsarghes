import assert from "node:assert/strict";
import test from "node:test";

import { CATALOG_SQL, captureLiveSchemaCatalog } from "./capture-live-schema-contract-catalog.mjs";

const catalog = {
  schemaVersion: 1,
  relations: [{ schema: "public", name: "dealer_shift_metrics", relkind: "v", columns: [] }],
  functions: [],
};

test("catalog capture calls only the Management API read-only SQL endpoint", async () => {
  const calls = [];
  const result = await captureLiveSchemaCatalog({
    projectRef: "orlesggcjamwuknxwcpk",
    accessToken: "test-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify([{ catalog }]), { status: 201 });
    },
  });
  assert.deepEqual(result, catalog);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/database\/query\/read-only$/);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(JSON.parse(calls[0].options.body).query, CATALOG_SQL);
  assert.match(CATALOG_SQL, /pg_catalog\.pg_class/);
  assert.match(CATALOG_SQL, /namespace\.nspname IN \('public', 'storage'\)/);
  assert.match(CATALOG_SQL, /FROM pg_catalog\.pg_proc[\s\S]*WHERE namespace\.nspname = 'public'/);
  assert.doesNotMatch(CATALOG_SQL, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
  assert.match(CATALOG_SQL,/md5\(replace\(replace\(pg_get_functiondef/);
  assert.match(CATALOG_SQL,/routine\.prokind IN \('f','p'\)/);
  assert.doesNotMatch(CATALOG_SQL,/'definition',\s*pg_get_functiondef/);
});

test("catalog capture fails closed for missing credentials and malformed payloads without printing values", async () => {
  await assert.rejects(
    captureLiveSchemaCatalog({ projectRef: "orlesggcjamwuknxwcpk", accessToken: "" }),
    /SUPABASE_ACCESS_TOKEN is required/,
  );
  await assert.rejects(
    captureLiveSchemaCatalog({
      projectRef: "orlesggcjamwuknxwcpk",
      accessToken: "test-token",
      fetchImpl: async () => new Response(JSON.stringify([{ catalog: { schemaVersion: 2 } }]), { status: 201 }),
    }),
    /invalid catalog/,
  );
});

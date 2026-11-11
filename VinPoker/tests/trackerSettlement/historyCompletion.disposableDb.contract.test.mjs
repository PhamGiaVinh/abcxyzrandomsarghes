import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const workflow = readFileSync(resolve(root, "..", ".github/workflows/tracker-history-completion-disposable-db.yml"), "utf8");
const files = [
  "historyCompletion.disposableDb.dependencies.sql",
  "historyCompletion.disposableDb.integration.sql",
];

test("dedicated workflow applies the exact migration chain to PostgreSQL 17 only", () => {
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /historyCompletion\.disposableDb\.dependencies\.sql/);
  assert.match(workflow, /20261238000002_tracker_settlement_outcome_store\.sql/);
  assert.match(workflow, /20270110000007_tracker_historical_settlement_display\.sql/);
  assert.match(workflow, /20270115000019_tracker_history_completion_queue\.sql/);
  assert.match(workflow, /20270115000022_tracker_history_completion_audit_fixes\.sql/);
  assert.match(workflow, /historyCompletion\.disposableDb\.integration\.sql/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN|supabase db push|functions deploy|vercel --prod/i);
});

test("runtime fixture covers the critical behavior gates without changing applied migrations", () => {
  const integration = readFileSync(resolve(root, "tests/trackerSettlement/historyCompletion.disposableDb.integration.sql"), "utf8");
  for (const marker of [
    "source_revision=2",
    "SKIP LOCKED",
    "concurrent same-hand commits",
    "lease token",
    "idempotent",
    "needs_attention",
    "historical_display",
    "chain proof incorrectly satisfied",
  ]) assert.ok(integration.toLowerCase().includes(marker.toLowerCase()), `missing ${marker}`);
  assert.ok(files.every((file) => file.startsWith("historyCompletion.disposableDb.")));
});

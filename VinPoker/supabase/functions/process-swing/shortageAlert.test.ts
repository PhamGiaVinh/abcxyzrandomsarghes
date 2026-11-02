import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  classifyShortage,
  buildCanonicalShortageSnapshot,
  decideShortageAlert,
  dedupeActiveAttendance,
  formatShortageTelegram,
  sanitizeShortageSnapshot,
  shortageSeverity,
  type CanonicalShortageSnapshot,
} from "./shortageAlert.ts";

// Malformed/failed transport boundaries only. Positive scope behavior is also
// exercised against actual PostgreSQL by --main-worker --main-shortage-scope.
const operational = { id: "table-a", table_session_id: "session-a", table_name: "TEST A", table_type: "cash", tournament_id: null };
function snapshotClient(inventory: { data: unknown; error: unknown }, overrides: Record<string, unknown> = {}) {
  const queried: string[] = [];
  const rows: Record<string, unknown> = {
    game_tables: [{ id: "table-a", table_name: "TEST A", game_type: null, tour_tier: null }],
    dealer_open_operations: [], dealer_attendance: [], dealer_assignments: [], ...overrides,
  };
  return { queried, rpc: async (name: string) => { assertEquals(name, "get_dealer_operational_tables_v1"); return inventory; },
    from(name: string) {
      queried.push(name);
      if (!(name in rows)) throw new Error(`Unexpected query ${name}`);
      const query = { select: () => query, eq: () => query, in: () => query, is: () => query, gt: () => query,
        then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: rows[name], error: null }).then(resolve) };
      return query;
    },
  };
}
const scopeOptions = { minInterSwingRestMinutes: 15, clubBreakDurationMinutes: 15, preAnnounceMinutes: 3 };

Deno.test("shortage snapshot fails closed on unavailable or malformed canonical inventory", async () => {
  for (const response of [
    { data: null, error: { code: "PGRST202" } }, { data: null, error: null },
    { data: [operational, operational], error: null },
    { data: [{ ...operational, table_session_id: null }], error: null },
  ]) {
    const client = snapshotClient(response);
    const result = await buildCanonicalShortageSnapshot(client, "club-a", scopeOptions);
    assertEquals(classifyShortage(result), "snapshot_invalid");
    assertMatch(result.error_code ?? "", /^shortage_snapshot_operational_inventory_/);
    assertEquals(client.queried, []);
  }
});

Deno.test("missing, duplicate or foreign operational metadata never becomes healthy empty", async () => {
  for (const rows of [[], null, [null], [{ id: "foreign-table" }], [operational, operational]]) {
    const result = await buildCanonicalShortageSnapshot(snapshotClient({ data: [operational], error: null }, { game_tables: rows }), "club-a", scopeOptions);
    assertEquals(result.status, "query_failed"); assertEquals(classifyShortage(result), "snapshot_invalid");
  }
  for (const table of ["dealer_open_operations", "dealer_attendance", "dealer_assignments"]) {
    const result = await buildCanonicalShortageSnapshot(snapshotClient({ data: [operational], error: null }, { [table]: null }), "club-a", scopeOptions);
    assertEquals(result.status, "query_failed"); assertEquals(classifyShortage(result), "snapshot_invalid");
  }
});

Deno.test("shortage snapshot refuses ambiguous, cross-club and stale-session assignments", async () => {
  const assignment = { id: "assignment-a", club_id: "club-a", table_id: "table-a", table_session_id: "session-a" };
  for (const rows of [
    [null],
    [{ ...assignment, table_session_id: "session-old" }], [{ ...assignment, table_session_id: null }],
    [{ ...assignment, club_id: "club-b" }], [{ ...assignment, table_id: "foreign-table" }],
    [assignment, { ...assignment, id: "assignment-b" }],
  ]) {
    const result = await buildCanonicalShortageSnapshot(snapshotClient({ data: [operational], error: null }, { dealer_assignments: rows }), "club-a", scopeOptions);
    assertEquals(result.status, "query_failed"); assertEquals(result.error_code, "shortage_snapshot_assignment_scope_query_failed");
    assertEquals(classifyShortage(result), "snapshot_invalid");
  }
});

function snapshot(overrides: Partial<CanonicalShortageSnapshot> = {}): CanonicalShortageSnapshot {
  return {
    status: "ok",
    error_code: null,
    captured_at: "2026-07-21T00:00:00.000Z",
    active_staffed_tables: 19,
    active_empty_tables: 0,
    tables_due_for_relief: 19,
    tables_overdue_for_relief: 0,
    tables_without_replacement_total: 0,
    replacement_held_tables: 0,
    checked_in_active_dealers: 90,
    genuinely_available_dealers: 50,
    eligible_for_any_uncovered_table_total: 50,
    on_break_not_ready_dealers: 0,
    on_break_ready_dealers: 0,
    pre_assigned_dealers: 0,
    reserved_dealers: 0,
    active_meal_break_dealers: 0,
    feature_reserved_dealers: 0,
    pending_durable_mass_open_targets: 0,
    excluded_dealers: { busy: 0, fatigue: 0, rest: 0, game_type: 0, tier: 0, meal_break: 0 },
    ...overrides,
  };
}

Deno.test("query and dependency snapshot failures are fail-closed before Telegram eligibility", () => {
  for (const status of ["query_failed", "dependency_unavailable"] as const) {
    const decision = decideShortageAlert(snapshot({ status, error_code: `shortage_snapshot_tables_${status}` }), {
      row: { shortage_notify_telegram: true },
      error: null,
    });
    assertEquals(decision.classification, "snapshot_invalid");
    assertEquals(decision.notifyEnabled, false);
    assertEquals(decision.failure?.status, status);
  }
});

Deno.test("notification setting false or a setting query failure never enables Telegram", () => {
  const shortage = snapshot({
    tables_without_replacement_total: 2,
    eligible_for_any_uncovered_table_total: 0,
    genuinely_available_dealers: 0,
  });
  assertEquals(
    decideShortageAlert(shortage, { row: { shortage_notify_telegram: false }, error: null }),
    { classification: "true_shortage", notifyEnabled: false, failure: null },
  );
  const failedSetting = decideShortageAlert(shortage, {
    row: null,
    error: { code: "XX000", message: "connection reset" },
  });
  assertEquals(failedSetting.notifyEnabled, false);
  assertEquals(failedSetting.failure?.status, "query_failed");
  assertEquals(failedSetting.failure?.stage, "notification_setting");
});

Deno.test("available dealers and held replacements do not produce a false shortage", () => {
  assertEquals(
    classifyShortage(snapshot({ tables_without_replacement_total: 19, eligible_for_any_uncovered_table_total: 50 })),
    "healthy",
  );
  assertEquals(
    classifyShortage(snapshot({
      tables_without_replacement_total: 0,
      replacement_held_tables: 19,
      pre_assigned_dealers: 19,
      reserved_dealers: 19,
      eligible_for_any_uncovered_table_total: 0,
    })),
    "reserved_relief_pending",
  );
});

Deno.test("meal-break dealers are not counted as available and a real shortage is classified", () => {
  const mealBreakOnly = snapshot({
    tables_without_replacement_total: 2,
    eligible_for_any_uncovered_table_total: 0,
    genuinely_available_dealers: 0,
    active_meal_break_dealers: 1,
    on_break_ready_dealers: 0,
    excluded_dealers: { busy: 0, fatigue: 0, rest: 0, game_type: 0, tier: 0, meal_break: 1 },
  });
  assertEquals(classifyShortage(mealBreakOnly), "true_shortage");
  assertEquals(shortageSeverity(classifyShortage(mealBreakOnly)), 1);
});

Deno.test("checked-out attendance is ignored and duplicate checked-in attendance is deduplicated", () => {
  const rows = dedupeActiveAttendance([
    {
      id: "attendance-old",
      dealer_id: "dealer-a",
      current_state: "available",
      status: "checked_in",
      check_out_time: null,
      check_in_time: "2026-07-21T08:00:00.000Z",
      last_released_at: null,
    },
    {
      id: "attendance-new",
      dealer_id: "dealer-a",
      current_state: "available",
      status: "checked_in",
      check_out_time: null,
      check_in_time: "2026-07-21T09:00:00.000Z",
      last_released_at: null,
    },
    {
      id: "attendance-checked-out",
      dealer_id: "dealer-b",
      current_state: "available",
      status: "checked_in",
      check_out_time: "2026-07-21T09:00:00.000Z",
      check_in_time: "2026-07-21T08:00:00.000Z",
      last_released_at: null,
    },
  ]);
  assertEquals(rows.map((row) => row.id), ["attendance-new"]);
});

Deno.test("Telegram wording is evidence-based and the persisted snapshot is bounded and sanitized", () => {
  const critical = snapshot({
    tables_without_replacement_total: 3,
    tables_overdue_for_relief: 3,
    eligible_for_any_uncovered_table_total: 0,
    genuinely_available_dealers: 0,
    error_code: `raw error ${"x".repeat(9_000)}`,
  });
  assertEquals(classifyShortage(critical), "critical_shortage");
  const message = formatShortageTelegram("critical_shortage", critical);
  assertMatch(message ?? "", /Ban can nguoi thay: 3/);
  assertEquals((message ?? "").toLowerCase().includes("pool"), false);
  const sanitized = sanitizeShortageSnapshot(critical);
  assertEquals(sanitized.error_code, null);
  assertEquals(new TextEncoder().encode(JSON.stringify(sanitized)).byteLength <= 8_000, true);
});

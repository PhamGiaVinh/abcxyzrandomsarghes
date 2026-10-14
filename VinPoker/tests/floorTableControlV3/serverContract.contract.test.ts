import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const bridgeMigration = readFileSync(
  resolve(root, "supabase/migrations/20270113000010_floor_table_control_v3_final_live_bridge.sql"),
  "utf8",
);
const fixtureCompatibilityMigration = readFileSync(
  resolve(root, "supabase/migrations/20270112000009_floor_table_control_v3_fixture_live_status_compat.sql"),
  "utf8",
);
const contractMigration = readFileSync(
  resolve(root, "supabase/migrations/20270113000011_floor_table_control_v3_final_contract.sql"),
  "utf8",
);
const rosterEntryMigration = readFileSync(
  resolve(root, "supabase/migrations/20270114000006_tracker_roster_canonical_entry_link.sql"),
  "utf8",
);
const rosterDisplayNameMigration = readFileSync(
  resolve(root, "supabase/migrations/20270114000007_floor_v3_roster_seat_display_name.sql"),
  "utf8",
);
const testRosterRepair = readFileSync(
  resolve(root, "scripts/production/repairs/repair_tracker_test_roster_entries_ban5.sql"),
  "utf8",
);
const testRosterRepairFixture = readFileSync(
  resolve(root, "tests/floorTableControlV3/repairTrackerTestRoster.fixture.sql"),
  "utf8",
);
const partialTableLinkRepair = readFileSync(
  resolve(root, "scripts/production/repairs/repair_tracker_test_roster_tournament_table_link_ban5.sql"),
  "utf8",
);
const partialTableLinkWorkflow = readFileSync(
  resolve(root, "tests/floorTableControlV3/runPartialTableLinkRepair.sh"),
  "utf8",
);
const hardeningMarker = "-- Consolidated hardening from archived 20270113000005.";
const rosterMarker = "-- Consolidated roster read contract from archived 20270113000006.";
const serverContract = contractMigration.slice(0, contractMigration.indexOf(hardeningMarker));
const hardeningContract = contractMigration.slice(
  contractMigration.indexOf(hardeningMarker),
  contractMigration.indexOf(rosterMarker),
);
const rosterContract = contractMigration.slice(contractMigration.indexOf(rosterMarker));
const previewOnlyWriterGrants = readFileSync(
  resolve(root, "tests/floorTableControlV3/previewOnlyWriterGrants.sql"),
  "utf8",
);
const disposable = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.serverContract.sql"),
  "utf8",
);
const authenticatedDisposable = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.serverContract.authenticated.sql"),
  "utf8",
);
const concurrencySetup = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.serverContract.concurrent.setup.sql"),
  "utf8",
);
const concurrencyRunner = readFileSync(
  resolve(root, "tests/floorTableControlV3/runServerContractConcurrency.sh"),
  "utf8",
);
const workflow = readFileSync(
  resolve(root, "../.github/workflows/floor-table-control-v3-contract-disposable-db.yml"),
  "utf8",
);

describe("Floor Table Control V3 server contract", () => {
  it("normalizes only the stale fixture status required before bridge quarantine", () => {
    expect(fixtureCompatibilityMigration).toContain("20270113000010");
    expect(fixtureCompatibilityMigration).toContain("'11111111-1111-1111-1111-111111111111'::uuid");
    expect(fixtureCompatibilityMigration).toContain("live_status IN ('running', 'registering')");
    expect(fixtureCompatibilityMigration).toContain("SET live_status = 'registering'");
    expect(fixtureCompatibilityMigration).toContain("live_status = 'running'");
    expect(fixtureCompatibilityMigration).not.toMatch(/SET\s+(?:status|deleted_at)\s*=/i);
    expect(fixtureCompatibilityMigration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });

  it("transitions the historical permanent physical-table uniqueness only after exact explicit mapping", () => {
    expect(bridgeMigration).toContain("floor_table_v3_stage_test_receipt_changed");
    expect(bridgeMigration).toContain("floor_table_v3_final_live_bridge_real_identity_preflight_failed");
    expect(bridgeMigration).not.toContain("floor_table_v3_final_live_bridge_seat_entry_preflight_failed");
    expect(bridgeMigration).toContain("one-time bridge only requires exactly one active assignment");
    expect(bridgeMigration).toContain("without an entry remain immutable to V3 writers");
    expect(bridgeMigration).toContain("STAGE_TEST Tournament");
    expect(bridgeMigration).toContain("LOCK TABLE public.tournament_entries IN SHARE ROW EXCLUSIVE MODE");
    expect(bridgeMigration).toContain("LOCK TABLE public.game_tables IN SHARE ROW EXCLUSIVE MODE");
    expect(bridgeMigration).toContain("IF v_count <> 2 THEN");
    expect(bridgeMigration).toContain("IF v_count <> 5 THEN");
    expect(bridgeMigration).toContain("IF v_count <> 9 THEN");
    expect(contractMigration).toContain("floor_table_v3_legacy_assignment_preflight_failed");
    expect(contractMigration).toContain("tournament_row.deleted_at IS NULL");
    expect(contractMigration).toContain("tt.status = 'active'");
    expect(contractMigration).toContain("uq_tournament_tables_one_session_v3");
    expect(contractMigration).toContain("ALTER COLUMN table_id DROP NOT NULL");
    expect(contractMigration).toContain("ALTER TABLE public.tournament_tables DROP CONSTRAINT %I");
    expect(bridgeMigration).not.toMatch(/UPDATE\s+public\.tournament_(tables|seats|hands)\s+SET\s+table_id/i);
    expect(bridgeMigration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });

  it("keeps internal helpers non-callable and every public V3 RPC caller-bound", () => {
    expect(contractMigration).toContain("CREATE SCHEMA IF NOT EXISTS floor_private");
    expect(contractMigration).toContain("REVOKE ALL ON SCHEMA floor_private FROM PUBLIC, anon, authenticated, service_role");
    expect(contractMigration).toContain("REVOKE ALL ON FUNCTION floor_private.floor_table_v3_assert_tracker_context");
    expect(contractMigration).toContain("SET search_path = ''");
    expect(contractMigration).toContain("v_actor uuid := auth.uid()");
    expect(contractMigration).toContain("game_table_scope_mismatch");
    expect(contractMigration).toContain("GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3");
    expect(contractMigration).toContain("REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3");
    expect(contractMigration).toContain("REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) FROM authenticated");
    expect(contractMigration).toContain("floor_table_v3_guard_dealer_assignment_session");
    const dealerAssignmentGuard = contractMigration.slice(
      contractMigration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_guard_dealer_assignment_session"),
      contractMigration.indexOf("DROP TRIGGER IF EXISTS floor_table_v3_guard_dealer_assignment_session"),
    );
    expect(dealerAssignmentGuard).toContain("FOR KEY SHARE");
    expect(contractMigration).toContain("FOR SHARE");
    expect(dealerAssignmentGuard.indexOf("FOR KEY SHARE")).toBeLessThan(
      dealerAssignmentGuard.indexOf("FOR SHARE"),
    );
    expect(contractMigration).toContain("floor_table_v3_dealer_assignment_session_not_active");
  });

  it("makes physical-table leases, mode fencing, revisions and durable receipts explicit", () => {
    expect(serverContract).toContain("game_table_in_use");
    expect(serverContract).toContain("control_epoch = control_epoch + 1");
    expect(serverContract).toContain("STALE_TRACKER_CONTEXT");
    expect(serverContract).toContain("STALE_STATE");
    expect(serverContract).toContain("IDEMPOTENCY_CONFLICT");
    expect(serverContract).toContain("floor_table_v3_lock_receipt");
    expect(serverContract).toContain("floor_table_v3_save_receipt");
    expect(serverContract).toContain("ORDER BY gt.id FOR UPDATE");

    const breakWriter = hardeningContract.slice(
      hardeningContract.indexOf("CREATE OR REPLACE FUNCTION public.floor_break_table_v3"),
      hardeningContract.indexOf("ALTER FUNCTION public.floor_break_table_v3"),
    );
    expect(breakWriter).toContain("JOIN public.game_tables gt ON gt.id = session_row.game_table_id");
    expect(breakWriter).toContain("ORDER BY gt.id, session_row.id");
    expect(breakWriter).not.toContain("ORDER BY session_row.id FOR UPDATE");
  });

  it("uses entry-backed V3 roster mutations without a money or legacy-table writer", () => {
    expect(serverContract).toContain("registration_id IS NULL");
    expect(serverContract).toContain("entry_not_seatable");
    expect(serverContract).toContain("payout_applied', false");
    expect(serverContract).toContain("player_has_chips");
    expect(serverContract).toContain("manual_nonzero_chip_override");
    expect(serverContract).toContain("floor_break_table_v3");
    expect(serverContract).toContain("close_tournament_table_v3");
    expect(serverContract).not.toMatch(/INSERT\s+INTO\s+public\.tournament_(tables|seats|hands)\s*\([\s\S]*?\n\s*table_id\s*[,)]/i);
    expect(serverContract).not.toMatch(/sepay|staking|buy.?in|prize_payment/i);
  });

  it("adds a caller-bound canonical active-session roster without guessing legacy ids", () => {
    expect(rosterContract).toContain("get_floor_tournament_table_roster_v3");
    expect(rosterContract).toContain("get_floor_restorable_entries_v3");
    expect(rosterContract).toContain("seat_row.tournament_table_id = table_row.id");
    expect(rosterContract).toContain("seat_row.table_session_id = session_row.id");
    expect(rosterContract).toContain("session_row.closed_at IS NULL");
    expect(rosterContract).toContain("floor_table_v3_roster_access_denied");
    expect(rosterContract).toContain("SET search_path = ''");
    expect(rosterContract).not.toMatch(/UPDATE\s+public\.|DELETE\s+FROM\s+public\./i);
    expect(rosterContract).not.toMatch(/legacy\s+table_id.*=/i);
  });

  it("prefers active seat display identity without changing the roster ABI or restore contract", () => {
    expect(rosterDisplayNameMigration).toContain("NULLIF(pg_catalog.btrim(seat_row.player_name), '')");
    expect(rosterDisplayNameMigration).toContain("NULLIF(pg_catalog.btrim(profile_row.display_name), '')");
    expect(rosterDisplayNameMigration).toContain("entry_row.player_id::text");
    expect(rosterDisplayNameMigration.indexOf("NULLIF(pg_catalog.btrim(seat_row.player_name), '')")).toBeLessThan(
      rosterDisplayNameMigration.indexOf("NULLIF(pg_catalog.btrim(profile_row.display_name), '')"),
    );
    expect(rosterDisplayNameMigration).toContain("RETURNS TABLE(");
    expect(rosterDisplayNameMigration).toContain("SECURITY DEFINER");
    expect(rosterDisplayNameMigration).toContain("SET search_path = ''");
    expect(rosterDisplayNameMigration).toContain("TO authenticated");
    expect(rosterDisplayNameMigration).not.toContain("get_floor_restorable_entries_v3");
    expect(rosterDisplayNameMigration).not.toContain("INSERT INTO public.profiles");
    expect(rosterDisplayNameMigration).not.toContain("auth.users");
    expect(disposable).toContain("20270114000007_floor_v3_roster_seat_display_name.sql");
    expect(disposable).toContain("20270114000011_floor_redraw_seat_lock_v1.sql");
  });

  it("keeps V3 writers revoked in the active catalog and confines test grants", () => {
    expect(hardeningContract).toContain("REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) FROM authenticated");
    expect(hardeningContract).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.floor_open_tournament_table_v3/i);
    expect(previewOnlyWriterGrants).toContain("Preview/disposable-only authenticated writer grants");
    expect(previewOnlyWriterGrants).toContain("GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3");
    expect(previewOnlyWriterGrants).toContain("GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v3");
    expect(previewOnlyWriterGrants).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE/i);
    expect(previewOnlyWriterGrants).not.toMatch(/GRANT\s+USAGE\s+ON\s+SCHEMA/i);
  });

  it("creates canonical entry-backed Tracker walk-ins and fails closed on malformed edits", () => {
    expect(rosterEntryMigration).toContain("tracker_roster_entry_link_required");
    expect(rosterEntryMigration).toContain("INSERT INTO public.tournament_entries");
    expect(rosterEntryMigration).toContain("p_tournament_id, NULL, v_player_id, v_entry_number, 'manual'");
    expect(rosterEntryMigration).toContain("'seated', p_chip_count, v_tt.game_table_id");
    expect(rosterEntryMigration).toContain("tournament_table_id, table_session_id");
    expect(rosterEntryMigration).toContain("UPDATE public.tournament_entries");
    expect(rosterEntryMigration).toContain("SET current_stack = p_chip_count");
    expect(rosterEntryMigration).toContain("p_existing_player_id IS NULL OR p_existing_player_id IS DISTINCT FROM v_player_id");
    expect(rosterEntryMigration).toContain("REVOKE ALL ON FUNCTION public.set_tracker_table_roster_seat");
    expect(rosterEntryMigration).toContain("TO authenticated, service_role");
    expect(rosterEntryMigration).not.toMatch(/INSERT\s+INTO\s+public\.tournament_registrations/i);
    expect(rosterEntryMigration).not.toMatch(/seat_draw_receipts|payment|sepay|buy.?in/i);
  });

  it("keeps the one-time Test repair outside migrations and exact-allowlist only", () => {
    const ids = testRosterRepair.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu) ?? [];
    const allowed = new Set([
      "91cf8dab-fac3-4b70-9da9-7f94802f5078",
      "4b15b3b0-cf0c-4a3b-8072-b0d29f3d1ea6",
      "329b37ad-7e71-4239-8c8d-b28c5c858de4",
      "ada51a88-d93c-4648-8f90-e9905d4cedd9",
      "14405531-7688-4acc-b8be-fefc1322bc5d",
      "a209ae6e-4588-4e3b-b5f1-e1aa04454588",
      "0b199ee9-736b-4ed1-ac24-0d60fd3fcf61",
      "dfdea493-0585-4619-974e-20edc13b5ffb",
      "68ff52c6-10de-400d-8a59-35460e052414",
    ]);
    expect(new Set(ids.map((id) => id.toLowerCase()))).toEqual(allowed);
    expect(testRosterRepair).toContain("TEST_FIXTURE_ENTRY_LINK_REPAIRED");
    expect(testRosterRepair).toContain("TEST_FIXTURE_REPAIR_PREFLIGHT_FAILED");
    expect(testRosterRepair).toContain("TEST_FIXTURE_ON_REAL_TOURNAMENT_BLOCKED");
    expect(testRosterRepair).toContain("JOIN _tracker_test_roster_allowlist a");
    expect(testRosterRepair).toContain("AND s.entry_id IS NULL");
    expect(testRosterRepair).toContain("AND s.tournament_table_id IS NULL");
    expect(testRosterRepair).toContain("AND s.table_session_id IS NULL");
    expect(testRosterRepair).toContain("tournament_table_id = v_context.tournament_table_id");
    expect(testRosterRepair).toContain("table_session_id = v_context.table_session_id");
    expect(testRosterRepair).toContain("GET DIAGNOSTICS v_updated = ROW_COUNT");
    expect(testRosterRepair).not.toMatch(/INSERT\s+INTO\s+public\.tournament_registrations/iu);
    expect(testRosterRepairFixture).toContain("repair_tracker_test_roster_entries_ban5.sql");
    expect(testRosterRepairFixture).toContain("get_floor_tournament_table_roster_v3");
    expect(testRosterRepairFixture).toContain("validate_tracker_table_writer_context_v3");
    expect(testRosterRepairFixture).toContain("TRACKER_TEST_ROSTER_REPAIR_DISPOSABLE_PASS");
    expect(workflow).toContain("repairTrackerTestRoster.fixture.sql");
  });

  it("repairs only the exact partial-state tournament-table links", () => {
    expect(partialTableLinkRepair).toContain("TRACKER_TEST_ROSTER_PARTIAL_TABLE_LINK_REPAIRED");
    expect(partialTableLinkRepair).toContain("TARGET_TABLE_ACTIVE_HAND_BLOCKED");
    expect(partialTableLinkRepair).toContain("SET tournament_table_id=v.tournament_table_id");
    expect(partialTableLinkRepair).toContain("IF v_updated<>9");
    expect(partialTableLinkRepair).not.toMatch(/INSERT\s+INTO\s+public\.tournament_entries/iu);
    expect(partialTableLinkRepair).not.toMatch(/UPDATE\s+public\.tournament_(entries|chip_counts)/iu);
    for (const scenario of ["already_linked","wrong_entry","wrong_session","wrong_table","wrong_name","wrong_chips","extra_seat","missing_seat","wrong_tournament_name","closed_session","manual_session","target_active_hand"]) {
      expect(partialTableLinkWorkflow).toContain(`run_reject ${scenario}`);
    }
    expect(partialTableLinkWorkflow).toContain("repairTrackerTestRosterPartialTableLink.verify.sql");
  });

  it("proves lifecycle, fencing, ACL, authenticated callers and real races in isolated PostgreSQL 17", () => {
    expect(workflow).toContain("image: docker.io/library/postgres@sha256:3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3");
    expect(workflow).toContain("tests/floorFreeSitV1/rosterActions.interaction.test.tsx");
    expect(workflow).toContain("tests/floorTableControlV3/disposableDb.serverContract.sql");
    expect(workflow).toContain("disposableDb.serverContract.authenticated.sql");
    expect(workflow).toContain("disposableDb.serverContract.concurrent.setup.sql");
    expect(workflow).toContain("runServerContractConcurrency.sh");
    expect(workflow).toContain("vitest.serverContract.config.ts");
    expect(workflow).not.toMatch(/db push|functions deploy|vercel --prod|orlesggcjamwuknxwcpk/i);
    expect(disposable).toContain("FLOOR_TABLE_CONTROL_V3_SERVER_CONTRACT_DISPOSABLE_PASS");
    expect(disposable).toContain("20270112000009_floor_table_control_v3_fixture_live_status_compat.sql");
    expect(disposable).toContain("20270113000010_floor_table_control_v3_final_live_bridge.sql");
    expect(disposable).toContain("20270113000011_floor_table_control_v3_final_contract.sql");
    expect(disposable).toContain("STAGE_TEST fixture is quarantined");
    expect(disposable).toContain("count(*) = 5 FROM public.tournament_entries");
    expect(disposable).toContain("count(*) = 9 FROM public.tournament_seats");
    expect(disposable).toContain("identity bridge links legacy seats without changing orphan fields, hand or hand players");
    expect(disposable).toContain("legacy orphan cannot be mutated by entry-backed V3 bust writer");
    expect(authenticatedDisposable).toContain("previewOnlyWriterGrants.sql");
    expect(disposable).toContain("same idempotency request returns the original open result");
    expect(disposable).toContain("pre-mode-change Tracker context is fenced");
    expect(disposable).toContain("Tracker request from a closed session is fenced after physical-table reuse");
    expect(disposable).toContain("move leaves no ghost seat in the former table");
    expect(disposable).toContain("break ends the dealer assignment and session history together");
    expect(disposable).toContain("authenticated Floor cannot open another club physical table");
    expect(disposable).toContain("expected V3 dealer assignment guard for a closed session");
    expect(authenticatedDisposable).toContain("SET LOCAL ROLE authenticated");
    expect(authenticatedDisposable).toContain("FLOOR_TABLE_CONTROL_V3_AUTHENTICATED_CALLER_PASS");
    expect(authenticatedDisposable).toContain("authenticated cross-club access was not denied");
    expect(concurrencySetup).toContain("Dedicated exact-ID fixtures for real multi-connection races");
    expect(concurrencyRunner).toContain("same-seat race");
    expect(concurrencyRunner).toContain("Tracker roster same-seat race");
    expect(concurrencyRunner).toContain("set_tracker_table_roster_seat");
    expect(concurrencyRunner).toContain("move-vs-bust race");
    expect(concurrencyRunner).toContain("close-vs-dealer assignment race");
    expect(concurrencyRunner).toContain("SET LOCAL ROLE authenticated");
    expect(concurrencyRunner).toContain("deadlock_or_lock_timeout");
    expect(concurrencyRunner).toContain("floor_table_v3_dealer_assignment_session_not_active");
    expect(concurrencyRunner).toContain("grep -h -c");
    expect(concurrencyRunner).not.toContain("awk -F:");
  });
});

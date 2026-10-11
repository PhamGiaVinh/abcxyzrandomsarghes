import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261240000000_floor_production_hardening.sql");
const clockMigration = read("supabase/migrations/20261241000000_floor_clock_start_atomic.sql");
const operatorScopeMigration = read("supabase/migration-archive/historical-never-replay/20261242000000_floor_operator_scope.sql");
const cleanupIndexMigration = read("supabase/migration-archive/historical-never-replay/20270104000000_floor_cleanup_rotation_schedule_index.sql");
const chipCasMigration = read("supabase/migration-archive/historical-never-replay/20270104000001_floor_chip_cas_rpc.sql");
const clockControlMigration = read("supabase/migration-archive/historical-never-replay/20270104000004_floor_clock_control_atomic.sql");
const operatorScopeAclMigration = read("supabase/migration-archive/historical-never-replay/20270104000005_floor_operator_scope_acl.sql");
const tableControlModeMigration = read("supabase/migration-archive/historical-never-replay/20270105000004_floor_table_control_mode.sql");
const openTablePickerMigration = read("supabase/migrations/20270106000000_floor_open_table_picker_mode_v2.sql");
const drawEdge = read("supabase/functions/tournament-live-draw/index.ts");
const liveUpdateEdge = read("supabase/functions/tournament-live-update/index.ts");
const legacyStackRetirement = read("supabase/migrations/20270128000061_tracker_legacy_stack_retirement_v1.sql");
const clockEdge = read("supabase/functions/tournament-live-clock/index.ts");
const operatorClubsHook = read("src/hooks/useOperatorClubs.ts");
const stableFloorClubIdsHook = read("src/hooks/useStableFloorClubIds.ts");
const opsCapabilityProvider = read("src/ops/auth/OpsCapabilityProvider.tsx");
const opsCapabilityLoader = read("src/ops/auth/opsCapabilityLoader.ts");
const opsApp = read("src/OpsApp.tsx");
const cashierAccess = read("src/components/ops/OpsCashierAccess.tsx");
const desktopFloor = read("src/pages/FloorDashboard.tsx");
const floorTableMap = read("src/components/cashier/tournament-live/FloorTableMapPanel.tsx");
const playersGrouped = read("src/components/cashier/tournament-live/PlayersGroupedPanel.tsx");
const editChipsDialog = read("src/components/cashier/tournament-live/EditChipsDialog.tsx");
const clockPanel = read("src/components/cashier/tournament-live/ClockPanel.tsx");
const opsCockpit = read("src/pages/ops/OpsTournamentCockpit.tsx");
const floorPlayerActions = read("src/components/ops/shared/FloorPlayerActions.tsx");
const tableControlModeUi = read("src/components/ops/shared/FloorTableControlMode.tsx");
const tableModePickerUi = read("src/components/ops/shared/FloorTableModePicker.tsx");
const playerActionSheets = read("src/components/ops/shared/PlayerActionSheets.tsx");
const manualFloorBustDialog = read("src/components/cashier/tournament-live/ManualFloorBustConfirmDialog.tsx");
const standaloneHandInput = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
const tableControlResolver = read("src/lib/floorTableControlMode.ts");
const desktopPlayerActionSheet = read("src/components/cashier/tournament-live/PlayerActionSheet.tsx");
const openTableDialog = read("src/components/cashier/tournament-live/OpenTableDialog.tsx");
const floorTableNumberPicker = read("src/components/ops/shared/FloorTableNumberPicker.tsx");
const floorSeatRoster = read("src/components/ops/shared/FloorSeatRoster.tsx");
const floorTablePresentation = read("src/components/ops/shared/floorTablePresentation.ts");
const opsTables = read("src/pages/ops/OpsTables.tsx");
const floorTableDetailSheet = read("src/components/cashier/tournament-live/FloorTableDetailSheet.tsx");

function body(name: string, next?: string) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = next ? migration.indexOf(`CREATE OR REPLACE FUNCTION public.${next}`, start + 1) : migration.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

function tableControlBody(name: string, next?: string) {
  const start = tableControlModeMigration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = next ? tableControlModeMigration.indexOf(`CREATE OR REPLACE FUNCTION public.${next}`, start + 1) : tableControlModeMigration.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return tableControlModeMigration.slice(start, end);
}

describe("Floor V2 DB and Edge contracts", () => {
  it("retires weak stack writes without replacing the exact-session canonical writer", () => {
    expect(legacyStackRetirement).toContain("legacy_stack_definition_drift");
    expect(legacyStackRetirement).toContain("canonical_stack_writer_drift");
    expect(legacyStackRetirement).toContain("LEGACY_STACK_WRITE_RETIRED");
    expect(legacyStackRetirement.match(/SECURITY INVOKER SET search_path = ''/g)).toHaveLength(2);
    expect(legacyStackRetirement).not.toMatch(/CREATE OR REPLACE FUNCTION public\.set_tracker_table_roster_seat_v2/);
    expect(legacyStackRetirement).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM) public\./);
    expect(liveUpdateEdge).not.toContain('supabase.rpc("update_stack"');
    expect(liveUpdateEdge).not.toContain('supabase.rpc("bulk_update_stacks"');
    expect(liveUpdateEdge).toContain('validationError("LEGACY_STACK_WRITE_RETIRED"');
  });
  it("replaces each audited RPC with a definer function locked to public search_path", () => {
    for (const name of [
      "floor_assign_player_to_seat",
      "move_player_seat",
      "floor_bust_player",
      "restore_busted_player_to_seat",
      "close_tournament",
      "close_tournament_table",
      "redraw_tournament",
      "open_tournament_table",
    ]) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const grant = migration.indexOf(`GRANT EXECUTE ON FUNCTION public.${name}`, start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(grant).toBeGreaterThan(start);
      expect(migration.slice(start, grant)).toContain("SECURITY DEFINER");
      expect(migration.slice(start, grant)).toContain("SET search_path = public");
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}`);
    }
    expect(migration).not.toMatch(/TO authenticated, service_role;/);
    expect(clockMigration).not.toMatch(/TO authenticated, service_role;/);
  });

  it("derives the authenticated actor server-side and keeps legacy actor input optional", () => {
    const move = body("move_player_seat", "floor_bust_player");
    const restore = body("restore_busted_player_to_seat", "close_tournament");
    expect(move).toContain("v_actor UUID := auth.uid()");
    expect(move).toContain("p_actor_user_id UUID DEFAULT NULL");
    expect(move).toContain("IF p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_actor");
    expect(restore).toContain("v_actor UUID := auth.uid()");
    expect(restore).toContain("p_actor_user_id UUID DEFAULT NULL");
  });

  it("keeps moves and redraws fail-closed on stale or inconsistent seat graphs", () => {
    const move = body("move_player_seat", "floor_bust_player");
    const close = body("close_tournament_table", "redraw_tournament");
    const redraw = body("redraw_tournament", "open_tournament_table");
    expect(move).toContain("entry_id = p_entry_id");
    expect(move).toContain("'seat_entry_mismatch'");
    expect(move).toContain("'seat_occupied'");
    for (const fragment of ["'orphan_active_seat'", "'seat_entry_mismatch'", "'insufficient_capacity'"]) {
      expect(close).toContain(fragment);
    }
    expect(close).toContain("RAISE EXCEPTION 'source_table_not_empty'");
    expect(redraw).toContain("p_dry_run");
    expect(redraw).toContain("'orphan_active_seat'");
    expect(redraw).toContain("'seat_table_mismatch'");
    expect(redraw).toContain("CREATE TEMP TABLE _floor_redraw_plan");
  });

  it("makes bust and restore atomic without a payout side effect", () => {
    const bust = body("floor_bust_player", "restore_busted_player_to_seat");
    const restore = body("restore_busted_player_to_seat", "close_tournament");
    expect(bust).toContain("FOR UPDATE");
    expect(bust).toContain("'player_has_chips'");
    expect(bust).toContain("'player_in_active_hand'");
    expect(bust).toContain("'error', 'already_busted'");
    expect(bust).toContain("SET status = 'busted', is_active = false");
    expect(bust).toContain("'payout_applied', false");
    expect(restore).toContain("FROM public.tournament_close_report");
    expect(restore).toContain("FROM public.tournament_prize_payments");
    expect(restore).toContain("'prize_already_paid'");
    expect(restore).toContain("AND status = 'busted'");
  });

  it("keeps Manual Floor and Live Tracker policy in a forward server-side migration", () => {
    const setMode = tableControlBody("floor_set_table_control_mode", "floor_bust_player");
    const bust = tableControlBody("floor_bust_player", "floor_update_tournament_seat_chip");
    const chipCas = tableControlBody("floor_update_tournament_seat_chip", "start_hand");
    const startHand = tableControlBody("start_hand");

    expect(tableControlModeMigration).toContain("ADD COLUMN IF NOT EXISTS floor_control_mode TEXT NOT NULL DEFAULT 'manual'");
    expect(tableControlModeMigration).toContain("floor_control_revision BIGINT NOT NULL DEFAULT 0");
    expect(tableControlModeMigration).toContain("CHECK (floor_control_mode IN ('manual', 'tracker'))");
    expect(setMode).toContain("v_actor UUID := auth.uid()");
    expect(setMode).toContain("SECURITY DEFINER");
    expect(setMode).toContain("SET search_path = public");
    expect(setMode).toContain("p_expected_control_revision BIGINT");
    expect(setMode).toContain("floor_control_revision = p_expected_control_revision");
    expect(setMode).toContain("'stale_table_control_mode'");
    expect(setMode).toContain("'table_has_active_hand'");
    expect(setMode).toContain("floor_table_control_mode_changed");
    expect(setMode).toContain("'payout_applied', false");
    expect(setMode).toMatch(/REVOKE ALL ON FUNCTION public\.floor_set_table_control_mode[\s\S]*FROM PUBLIC, anon, service_role;/);
    expect(setMode).toMatch(/GRANT EXECUTE ON FUNCTION public\.floor_set_table_control_mode[\s\S]*TO authenticated;/);

    for (const source of [setMode, bust, startHand]) {
      expect(source).toContain("pg_advisory_xact_lock(");
      expect(source).toContain("hashtext(p_tournament_id::text)");
      expect(source).toContain("hashtext(v_tt.id::text)");
    }
    expect(bust).toContain("v_seat.table_id IN (tt.id, tt.table_id)");
    expect(bust).toContain("h.table_id IN (v_tt.id, v_tt.table_id)");
    expect(bust.indexOf("'player_in_active_hand'")).toBeLessThan(bust.indexOf("'player_has_chips'"));
    expect(bust).toContain("v_tt.floor_control_mode = 'tracker'");
    expect(bust).toContain("'tracker_chip_state_mismatch'");
    expect(bust).toContain("v_tracker_chip_count IS DISTINCT FROM v_seat.chip_count");
    expect(bust).toContain("manual_nonzero_chip_override");
    expect(bust).toContain("chip_count_before");
    expect(bust).toContain("'payout_applied', false");
    expect(bust).not.toContain("tournament_prize_payments");

    expect(chipCas).toContain("'tracker_table_chip_authority'");
    expect(chipCas).toContain("v_table_match_count <> 1");
    expect(chipCas).toMatch(/REVOKE ALL ON FUNCTION public\.floor_update_tournament_seat_chip[\s\S]*FROM PUBLIC, anon, service_role;/);

    expect(startHand).toContain("h.status = 'in_progress'");
    expect(startHand).toContain("h.table_id IN (v_tt.id, v_tt.table_id)");
    expect(startHand).toContain("'error_code', 'table_has_active_hand'");
    expect(startHand).toContain("'error_code', 'tracker_table_required'");
    expect(startHand.indexOf("'tracker_table_required'")).toBeLessThan(startHand.indexOf("SELECT h.id, h.locked_at"));
    expect(startHand).toContain("tt.floor_control_mode");

    expect(liveUpdateEdge).toContain('action === "start_hand"');
    expect(liveUpdateEdge).toContain('status: 409');
    expect(liveUpdateEdge).toContain('tracker_table_required');
    expect(standaloneHandInput).toContain("handData?.error || handData?.status !== \"success\" || !handData?.hand_id");
    expect(standaloneHandInput).toContain("const nestedError = typeof handData?.error === \"string\"");
  });

  it("renders a deliberate table selector and manual non-zero warning before Floor bust", () => {
    expect(tableControlModeUi).toContain('data-testid="floor-table-control-mode"');
    expect(tableControlModeUi).toContain("FloorTableModePicker");
    expect(tableControlModeUi).toContain('testIdPrefix="floor-table-control-mode"');
    expect(tableModePickerUi).toContain('data-testid={`${testIdPrefix}-${item.mode}`}');
    expect(tableModePickerUi).toContain('role="radio"');
    expect(tableControlModeUi).toContain('data-testid="floor-table-control-mode-save"');
    expect(tableControlModeUi).toContain('data-testid="floor-table-control-mode-confirm"');
    expect(tableControlModeUi).toContain("client.requestTableControlMode");
    expect(tableControlModeUi).toContain("expectedRevision: table.floor_control_revision");
    expect(tableControlModeUi).toContain("expectedEpoch: table.control_epoch");
    expect(tableControlModeUi).toContain("tableSessionId: table.table_session_id");
    expect(tableControlModeUi).not.toContain("floor_set_table_control_mode");
    expect(floorPlayerActions).toContain("Bàn Live Tracker chỉ cho phép loại khi chip đã về 0.");
    expect(playerActionSheets).toContain("Bàn Manual Floor: người chơi còn");
    expect(playerActionSheets).toContain("không tạo payout");
    expect(manualFloorBustDialog).toContain("Server sẽ ghi số chip hiện tại vào audit và không tạo payout.");
    expect(manualFloorBustDialog).toContain('data-testid="floor-manual-bust-confirm"');
    expect(floorTableMap).toContain("ManualFloorBustConfirmDialog");
    expect(playersGrouped).toContain("ManualFloorBustConfirmDialog");
    expect(floorTableMap).toContain("setDetailTableId");
    expect(floorTableMap).toContain("findFloorTableControlRow");
    expect(tableControlResolver).toContain("matches.length === 1");
    expect(desktopPlayerActionSheet).toContain("editDisabledReason");
    expect(playerActionSheets).toContain("chipEditDisabledReason");
    expect(playerActionSheets).toContain("Tracker quản lý chip");
    expect(floorTableMap).not.toContain("bust_tournament_player_with_payout");
    expect(floorTableMap).not.toContain("preview_tournament_bust");
  });

  it("opens a selected 1-100 nine-seat table and its chip authority atomically", () => {
    expect(openTablePickerMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.floor_open_tournament_table_v2",
    );
    expect(openTablePickerMigration).toContain("v_actor UUID := auth.uid()");
    expect(openTablePickerMigration).toContain("SECURITY DEFINER");
    expect(openTablePickerMigration).toContain("SET search_path = public");
    expect(openTablePickerMigration).toContain(
      "p_table_number IS NULL OR p_table_number < 1 OR p_table_number > 100",
    );
    expect(openTablePickerMigration).toContain(
      "p_control_mode NOT IN ('manual', 'tracker')",
    );
    expect(openTablePickerMigration).toContain(
      "v_open_result := public.open_tournament_table(",
    );
    expect(openTablePickerMigration).toMatch(
      /public\.open_tournament_table\(\s*p_tournament_id,\s*p_table_number,\s*9\s*\)/,
    );
    expect(openTablePickerMigration).toContain("SET max_seats = 9");
    expect(openTablePickerMigration).toContain("floor_control_mode = p_control_mode");
    expect(openTablePickerMigration).toContain(
      "floor_control_revision = floor_control_revision + 1",
    );
    expect(openTablePickerMigration).toContain("floor_table_opened_v2");
    expect(openTablePickerMigration).toContain("floor_table_reopened_v2");
    expect(openTablePickerMigration).toContain("'payout_applied', false");
    expect(openTablePickerMigration).toContain("MESSAGE = 'table_mode_apply_failed'");
    expect(openTablePickerMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.floor_open_tournament_table_v2\(UUID, INTEGER, TEXT\)\s+FROM PUBLIC, anon, service_role;/,
    );
    expect(openTablePickerMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.floor_open_tournament_table_v2\(UUID, INTEGER, TEXT\)\s+TO authenticated;/,
    );
    expect(openTablePickerMigration).not.toContain("tournament_prize_payments");
    expect(openTablePickerMigration).not.toContain("payout_applied', true");
  });

  it("uses one responsive picker and a visible nine-row roster across Floor surfaces", () => {
    expect(openTableDialog).toContain('"floor_open_tournament_table_v2"');
    expect(openTableDialog).toContain("<FloorTableNumberPicker");
    expect(openTableDialog).toContain("Manual Floor");
    expect(openTableDialog).toContain("Live Tracker");
    expect(openTableDialog).toContain("FIXED_FLOOR_TABLE_SEATS");
    expect(floorTableNumberPicker).toContain("Tìm số 1–100");
    expect(floorTablePresentation).toContain("FLOOR_TABLE_NUMBER_MAX = 100");
    expect(floorTablePresentation).toContain("FIXED_FLOOR_TABLE_SEATS = 9");
    expect(floorSeatRoster).toContain("Danh sách người chơi");
    expect(floorSeatRoster).toContain("Empty");
    expect(floorTableDetailSheet).toContain("<FloorSeatRoster");
    expect(floorTableMap).toContain("<FloorTableRosterIndex");
    expect(opsTables).toContain("<FloorSeatRoster");
    expect(opsTables).toContain("<FloorTableRosterIndex");
    expect(opsTables).toContain("<OpenTableDialog");
    expect(opsTables).not.toContain('supabase.rpc("open_tournament_table"');
  });

  it("starts the tournament clock under one tournament lock and audited transition", () => {
    expect(clockMigration).toContain("CREATE OR REPLACE FUNCTION public.floor_start_tournament_clock");
    expect(clockMigration).toContain("v_actor UUID := auth.uid()");
    expect(clockMigration).toContain("FOR UPDATE");
    expect(clockMigration).toContain("clock_started_at IS NOT NULL");
    expect(clockMigration).toContain("AND clock_started_at IS NULL");
    expect(clockMigration).toContain("tournament_state_transitions");
    expect(clockMigration).toContain("floor_tournament_clock_started");
  });

  it("routes every post-start clock write through one caller-bound locked RPC", () => {
    expect(clockControlMigration).toContain("CREATE OR REPLACE FUNCTION public.floor_control_tournament_clock");
    expect(clockControlMigration).toContain("v_actor UUID := auth.uid()");
    expect(clockControlMigration).toContain("SECURITY DEFINER");
    expect(clockControlMigration).toContain("SET search_path = public");
    expect(clockControlMigration).toContain("FOR UPDATE");
    expect(clockControlMigration).toContain(
      "v_tour.status::TEXT IN ('completed', 'cancelled', 'finished')",
    );
    expect(clockControlMigration).toContain("p_expected_control_revision TEXT");
    expect(clockControlMigration).toContain("v_current_control_revision := md5(jsonb_build_array(");
    expect(clockControlMigration).toContain("p_expected_control_revision !~ '^[0-9a-f]{32}$'");
    expect(clockControlMigration).toContain("IS DISTINCT FROM p_expected_control_revision");
    expect(clockControlMigration).toContain("'expected_control_revision_required'");
    expect(clockControlMigration).toContain("'clock_paused_at', v_tournament.clock_paused_at");
    expect(clockControlMigration).toContain("'stale_clock_state'");
    expect(clockControlMigration).toContain("clock_started_at = v_now");
    expect(clockControlMigration).toContain("pause_accumulated = 0");
    expect(clockControlMigration).toContain("v_target_elapsed_seconds");
    expect(clockControlMigration).toContain("v_new_started_at := v_reference_time");
    expect(clockControlMigration).toContain("FROM public.club_cashiers cc");
    expect(clockControlMigration).toContain("FROM public.club_floors cf");
    expect(clockControlMigration).not.toContain("public.user_roles");
    for (const action of ["pause", "resume", "next_level", "previous_level", "adjust_time"]) {
      expect(clockControlMigration).toContain(`'${action}'`);
    }
    expect(clockControlMigration).toContain("floor_tournament_clock_controlled");
    const clockControlSignature = String.raw`UUID,\s*TEXT,\s*INTEGER,\s*TEXT`;
    expect(clockControlMigration).toMatch(
      new RegExp(
        String.raw`REVOKE ALL ON FUNCTION public\.floor_control_tournament_clock\(\s*${clockControlSignature}\s*\) FROM PUBLIC, anon, service_role;`,
      ),
    );
    expect(clockControlMigration).toMatch(
      new RegExp(
        String.raw`GRANT EXECUTE ON FUNCTION public\.floor_control_tournament_clock\(\s*${clockControlSignature}\s*\) TO authenticated;`,
      ),
    );
    expect(clockControlMigration).not.toMatch(/CREATE POLICY[\s\S]*ON public\.tournaments/i);
    expect(clockControlMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.floor_control_tournament_clock\([\s\S]*?\) TO service_role;/,
    );
  });

  it("binds Floor operator scope to auth.uid and real club memberships", () => {
    expect(operatorScopeMigration).toContain("auth.uid()");
    expect(operatorScopeMigration).toContain("clubs.owner_id");
    expect(operatorScopeMigration).toContain("public.club_cashiers");
    expect(operatorScopeMigration).toContain("public.club_floors");
    expect(operatorScopeMigration).not.toContain("public.user_roles");
    expect(operatorScopeMigration).toContain("REVOKE ALL ON FUNCTION public.get_my_floor_operator_scope() FROM PUBLIC, anon");
    expect(operatorScopeMigration).toContain("GRANT EXECUTE ON FUNCTION public.get_my_floor_operator_scope() TO authenticated");
    expect(operatorScopeAclMigration).toContain(
      "FROM PUBLIC, anon, service_role;",
    );
    expect(operatorScopeAclMigration).toContain(
      "TO authenticated;",
    );
    expect(operatorScopeAclMigration).not.toMatch(/TO\s+service_role\s*;/i);
  });

  it("uses caller-bound capability scope in Floor UI and Edge handlers", () => {
    expect(operatorClubsHook).toContain('supabase.rpc("get_my_floor_operator_scope")');
    expect(operatorClubsHook).not.toContain('supabase.rpc("cashier_club_ids"');
    expect(operatorClubsHook).not.toContain('supabase.rpc("floor_club_ids"');
    expect(opsCapabilityLoader).toContain('client.rpc("get_my_floor_operator_scope")');
    expect(opsCapabilityLoader).toContain('function isMissingUnifiedScopeRpc');
    expect(opsCapabilityLoader).toContain('error?.code === "42883" || error?.code === "PGRST202"');
    expect(opsCapabilityProvider).toContain('getModuleClubIds(getOpsModule("floor"), scope)');
    expect(opsCapabilityProvider).toContain('getModuleClubIds(getOpsModule("cashier"), scope)');
    expect(opsApp).toContain('<OpsModuleGate capability="floor">');
    expect(opsApp).toContain("<OpsTournamentScopeGate>");
    expect(cashierAccess).toContain("hasCashierAccess");
    expect(desktopFloor).toContain("operatorClubIds");
    expect(desktopFloor).toContain("useStableFloorClubIds(operatorClubIds, dealerClubIds)");
    expect(stableFloorClubIdsHook).toContain("Array.from(new Set(groups.flat())).sort()");
    expect(stableFloorClubIdsHook).toContain("useMemo(() => JSON.parse(scopeKey) as string[], [scopeKey])");
    expect(desktopFloor).not.toContain("{ clubs, clubIds, dealerClubIds }");
    expect(desktopFloor).not.toContain("clubIds.length === 0");
    expect(desktopFloor).toContain('<TournamentLivePanel mode="floor" clubIds={scopedIds} clubs={clubs} />');
    expect(floorTableMap).toContain('supabase.rpc("get_my_floor_operator_scope")');
    expect(floorTableMap).toContain("row.can_owner || row.can_cashier || row.can_floor");
    expect(floorTableMap).not.toContain('supabase.rpc("cashier_club_ids"');
    // This panel no longer passes an untyped rpc method as a callback. Its
    // caller-bound capability query stays direct, so a method binding is not
    // required here.
    expect(floorTableMap).not.toContain("callUntypedRpc(");
    for (const floorActionSource of [floorPlayerActions, opsCockpit]) {
      expect(floorActionSource).toContain("supabase.rpc.bind(supabase)");
      expect(floorActionSource).not.toContain("const untypedFloorRpc = supabase.rpc as unknown");
    }
    expect(playersGrouped).toContain('supabase.rpc("get_my_floor_operator_scope")');
    expect(playersGrouped).toContain("row.can_owner || row.can_cashier || row.can_floor");
    expect(playersGrouped).not.toContain('supabase.rpc("cashier_club_ids"');

    for (const edge of [drawEdge, clockEdge]) {
      expect(edge).toContain("supabase.auth.getUser()");
      expect(edge).toContain('supabase.rpc("get_my_floor_operator_scope")');
      expect(edge).not.toContain('supabase.rpc("floor_club_ids"');
      expect(edge).not.toContain('supabase.rpc("cashier_club_ids"');
      expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(edge).not.toMatch(
        /response\(\{\s*error:\s*(?:error\.)?(?:message|details?|hint)\b/,
      );
    }
    expect(drawEdge).toContain("body.seats.length !== 1");
    expect(drawEdge).toContain("expected_chip_count");
    expect(editChipsDialog).toContain("expected_chip_count: seat.chip_count");
    expect(drawEdge).toMatch(/supabase\.rpc\(\s*"floor_bust_player"/);
    expect(drawEdge).toContain('error: "draw_operation_failed"');
    expect(clockEdge).toMatch(/supabase\.rpc\(\s*"floor_start_tournament_clock"/);
    expect(clockEdge).toMatch(/supabase\.rpc\(\s*"floor_control_tournament_clock"/);
    expect(clockEdge).toContain("readExpectedControlRevision(body)");
    expect(clockEdge).toContain("readLegacyControlRevision(");
    expect(clockEdge).toContain("p_expected_control_revision: expectedControlRevision");
    expect(clockEdge).not.toContain("p_expected_current_level");
    expect(clockEdge).not.toContain("p_expected_clock_started_at");
    expect(clockEdge).not.toContain("p_expected_clock_paused_at");
    expect(clockEdge).toContain("isTerminalTournamentStatus(tournament.status)");
    expect(clockEdge).not.toMatch(/\.from\("tournaments"\)\s*\.update/);
    expect(clockEdge).not.toContain("stale_clock_state");
    expect(clockEdge).toContain('error: "clock_operation_failed"');
    for (const ui of [clockPanel, opsCockpit]) {
      expect(ui).toContain("expected_control_revision: expectedControlRevision");
      expect(ui).toContain("canUseTournamentClockPostStartControls");
      expect(
        ui.includes("await loadClock()") || ui.includes("await Promise.all([loadClk()"),
      ).toBe(true);
    }
  });

  it("keeps the applied cleanup index as a standalone idempotent source contract", () => {
    expect(cleanupIndexMigration).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(cleanupIndexMigration).toContain("idx_dealer_rotation_schedule_table_id");
    expect(cleanupIndexMigration).toContain("ON public.dealer_rotation_schedule (table_id)");
    expect(cleanupIndexMigration).not.toMatch(/\bBEGIN\b\s*;/i);
    expect(cleanupIndexMigration).not.toMatch(/\bCOMMIT\b\s*;/i);
  });

  it("routes Floor chip CAS through one caller-bound, column-narrow RPC", () => {
    expect(chipCasMigration).toContain("CREATE OR REPLACE FUNCTION public.floor_update_tournament_seat_chip");
    expect(chipCasMigration).toContain("v_actor UUID := auth.uid()");
    expect(chipCasMigration).toContain("SECURITY DEFINER");
    expect(chipCasMigration).toContain("SET search_path = public");
    expect(chipCasMigration).toContain("FROM public.club_floors cf");
    expect(chipCasMigration).toContain("FOR UPDATE");
    expect(chipCasMigration).toContain("AND chip_count = p_expected_chip_count");
    expect(chipCasMigration).toMatch(/UPDATE public\.tournament_seats\s+SET chip_count = p_chip_count/);
    expect(chipCasMigration).not.toMatch(/CREATE POLICY[\s\S]*tournament_seats/i);
    expect(chipCasMigration).toContain("REVOKE ALL ON FUNCTION public.floor_update_tournament_seat_chip");
    expect(chipCasMigration).not.toMatch(/TO authenticated, service_role;/);
    expect(drawEdge).toMatch(/supabase\.rpc\(\s*"floor_update_tournament_seat_chip"/);
    expect(drawEdge).not.toMatch(/\.from\("tournament_seats"\)\s*\.update\(\{ chip_count:/);
  });
});

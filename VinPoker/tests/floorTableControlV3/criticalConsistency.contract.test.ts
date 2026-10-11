import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFloorTableControlV3Client } from "@/lib/floorTableControlV3";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20270128000007_floor_v3_critical_consistency.sql",
), "utf8");
const repairRunbook = readFileSync(resolve(
  process.cwd(),
  "docs/runbooks/FLOOR_V3_ORPHAN_SESSION_REPAIR_20260927.sql",
), "utf8");
const reconciliation = JSON.parse(readFileSync(resolve(
  process.cwd(),
  "supabase/migration-archive/floor-v3-catalog-reconciliation.manifest.json",
), "utf8"));

const baseRosterRow = {
  tournament_id: "tour-1",
  tournament_table_id: "table-1",
  game_table_id: "physical-1",
  table_number: 8,
  table_name: "Bàn 8",
  table_session_id: "session-1",
  session_revision: 4,
  control_mode: "manual",
  control_epoch: 1,
  max_seats: 9,
  tournament_table_status: "active",
  session_closed_at: null,
  active_dealer_assignment_id: null,
  seat_locks: [],
};

describe("Floor V3 critical consistency contract", () => {
  it("reads existing reservations even when the deferred producer flag is OFF", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ pending_move_id: "pending", entry_id: "entry",
      source_tournament_table_id: "source", destination_tournament_table_id: "destination",
      destination_seat_number: 3, status: "pending", resolution_reason: null, requested_at: "2026-10-10T00:00:00Z" }], error: null });
    const client = createFloorTableControlV3Client(rpc, { enabled: true, deferredTrackerMoveEnabled: false });
    expect(await client.getPendingTrackerMoves("tour")).toMatchObject({ ok: true, data: [{ pendingMoveId: "pending", destinationSeatNumber: 3 }] });
    expect(rpc).toHaveBeenCalledWith("get_floor_pending_tracker_moves_v1", { p_tournament_id: "tour" });
    expect(await client.queueTrackerMove({ entryId: "entry", toTournamentTableId: "destination", toSeatNumber: 3,
      expectedSourceRevision: 1, expectedDestinationRevision: 2, requestId: "request" })).toMatchObject({ ok: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not turn reservation read failure into empty when the producer is OFF", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "503" } });
    const client = createFloorTableControlV3Client(rpc, { enabled: true, deferredTrackerMoveEnabled: false });
    expect(await client.getPendingTrackerMoves("tour")).toEqual({ ok: false, error: "503" });
  });
  it("keeps orphan sessions visible for repair and legacy seats visible but fail-closed", () => {
    expect(migration).toContain("THEN 'repair_required'");
    expect(migration).toContain("'integrity_status', CASE WHEN e.id IS NULL THEN 'missing_entry' ELSE 'valid' END");
    expect(migration).toContain("LEFT JOIN public.tournament_entries e");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });

  it("previews an immutable break plan and queues moves into running Tracker tables", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.floor_plan_break_table_v1");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.floor_break_table_v5");
    expect(migration).toContain("'after_current_hand'");
    expect(migration).toContain("'STALE_BREAK_PLAN'");
    expect(migration).toContain("CREATE CONSTRAINT TRIGGER trg_floor_close_completed_break_source_v1");
    expect(migration).toContain("NEW.status NOT IN ('applied', 'stale', 'cancelled')");
    expect(migration).toContain("public.tournament_entries.status = 'seated'");
    expect(migration).toContain("INSERT INTO public.tournament_chip_counts");
    expect(migration).toContain("ts.tournament_id = tt.tournament_id");
    expect(migration).toContain("ts.game_table_id = tt.game_table_id");
    expect(migration).toContain("ts.club_id = tournament_row.club_id");
    expect(migration).toContain("gt.club_id = tournament_row.club_id");
    expect(migration).toContain("v_tournament.status IN ('completed', 'cancelled')");
    expect(migration).toContain("v_session.game_table_id IS DISTINCT FROM v_tt.game_table_id");
    expect(migration).toContain("v_session.club_id IS DISTINCT FROM v_tournament.club_id");
  });

  it("uses one physical-table, dealer-assignment, session, table and seat lock order", () => {
    const gameLock = migration.indexOf("PERFORM 1 FROM public.game_tables gt", migration.indexOf("FUNCTION public.floor_break_table_v5"));
    const assignmentLock = migration.indexOf("PERFORM 1 FROM public.dealer_assignments d", gameLock);
    const sessionLock = migration.indexOf("PERFORM 1 FROM public.table_sessions ts", assignmentLock);
    const tableLock = migration.indexOf("SELECT * INTO v_tt FROM public.tournament_tables", sessionLock);
    const moveLoop = migration.indexOf("FOR v_row IN SELECT * FROM floor_private.floor_break_plan_rows_v1", tableLock);
    expect(gameLock).toBeGreaterThan(-1);
    expect(assignmentLock).toBeGreaterThan(gameLock);
    expect(sessionLock).toBeGreaterThan(assignmentLock);
    expect(tableLock).toBeGreaterThan(sessionLock);
    expect(moveLoop).toBeGreaterThan(tableLock);

    const terminalTrigger = migration.indexOf("FUNCTION floor_private.floor_close_completed_break_source_v1");
    const terminalGameLock = migration.indexOf("PERFORM 1 FROM public.game_tables gt", terminalTrigger);
    const terminalAssignmentLock = migration.indexOf("PERFORM 1 FROM public.dealer_assignments d", terminalGameLock);
    const terminalSessionLock = migration.indexOf("PERFORM 1 FROM public.table_sessions ts", terminalAssignmentLock);
    const terminalTableLock = migration.indexOf("PERFORM 1 FROM public.tournament_tables tt", terminalSessionLock);
    expect(terminalGameLock).toBeGreaterThan(terminalTrigger);
    expect(terminalAssignmentLock).toBeGreaterThan(terminalGameLock);
    expect(terminalSessionLock).toBeGreaterThan(terminalAssignmentLock);
    expect(terminalTableLock).toBeGreaterThan(terminalSessionLock);
  });

  it("pins security-definer search paths and exposes only the reviewed authenticated RPCs", () => {
    for (const signature of [
      "public.get_floor_tournament_table_inventory_v1(uuid)",
      "public.get_floor_tournament_table_roster_v5(uuid)",
      "public.floor_plan_break_table_v1(uuid,bigint,text)",
      "public.floor_break_table_v5(uuid,bigint,uuid,text,text)",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`);
    }
    expect(migration).toContain("SECURITY DEFINER SET search_path = ''");
    expect(migration).toContain("auth.uid()");
  });

  it("allowlists only the exact reserved S5 migration bytes", () => {
    expect(reconciliation.ownerGatedActiveAllowlist).toContainEqual({
      version: "20270128000007",
      filename: "20270128000007_floor_v3_critical_consistency.sql",
      sha256: "2ec5997988f9b9a8eca6fe3af0c8998af03a9665958422e314aff7d33413f9eb",
      domain: "floor",
    });
  });

  it("parses an explicit missing-entry seat without treating it as an empty seat", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      ...baseRosterRow,
      seats: [{
        seat_number: 2,
        entry_id: null,
        player_id: "player-legacy",
        display_name: "Người chơi dữ liệu cũ",
        entry_no: null,
        chip_count: 15_000,
        is_active: true,
        integrity_status: "missing_entry",
      }],
    }], error: null });
    const client = createFloorTableControlV3Client(rpc, {
      enabled: true,
      redrawSeatLockEnabled: true,
    });

    const result = await client.getTournamentTableRoster("tour-1");
    expect(result).toEqual({ ok: true, data: [expect.objectContaining({
      seats: [expect.objectContaining({ entryId: null, integrityStatus: "missing_entry" })],
    })] });
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v6", { p_tournament_id: "tour-1" });
  });

  it.each(["invalid_participation", "unknown_integrity"])("parses integrity %s without making it valid", async (status) => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ ...baseRosterRow, seats: [{
      seat_number: 3, entry_id: "entry-4", player_id: "player-4", display_name: "Test 4",
      entry_no: 1, chip_count: 2_400_000, is_active: true, integrity_status: status,
    }] }], error: null });
    const client = createFloorTableControlV3Client(rpc, { enabled: true, redrawSeatLockEnabled: true });
    const result = await client.getTournamentTableRoster("tour-1");
    expect(result.ok).toBe(status === "invalid_participation");
    if (result.ok) expect(result.data[0].seats[0].integrityStatus).toBe("invalid_participation");
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v6", { p_tournament_id: "tour-1" });
  });

  it("preserves the flag-off legacy roster parser", async () => {
    const { max_seats: _maxSeats, seat_locks: _seatLocks, ...legacyRow } = baseRosterRow;
    const rpc = vi.fn().mockResolvedValue({ data: [{
      ...legacyRow,
      seats: [{
        seat_number: 1,
        entry_id: "entry-1",
        player_id: "player-1",
        display_name: "Người chơi 1",
        entry_no: 1,
        chip_count: 30_000,
        is_active: true,
      }],
    }], error: null });
    const client = createFloorTableControlV3Client(rpc, {
      enabled: true,
      redrawSeatLockEnabled: false,
    });

    const result = await client.getTournamentTableRoster("tour-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0].seats[0].integrityStatus).toBe("valid");
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v3", { p_tournament_id: "tour-1" });
  });

  it.each(["movePlayerSeatExact", "movePlayerSeatOrQueueExact"] as const)("%s sends exact move incarnation, epoch, reason and retry identity without an actor override", async (operation) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, request_id: "request-1" }, error: null });
    const client = createFloorTableControlV3Client(rpc, { enabled: true, redrawSeatLockEnabled: true });
    await client[operation]({ entryId: "entry-1", fromTournamentTableId: "table-1", fromTableSessionId: "session-1",
      toTournamentTableId: "table-2", toTableSessionId: "session-2", toSeatNumber: 3,
      expectedSourceRevision: 7, expectedDestinationRevision: 8, expectedSourceEpoch: 4, expectedDestinationEpoch: 5,
      reason: "Cân bàn", requestId: "request-1" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(operation === "movePlayerSeatExact" ? "move_player_seat_v4" : "move_player_seat_v5", {
      p_entry_id: "entry-1", p_from_tournament_table_id: "table-1", p_from_table_session_id: "session-1",
      p_to_tournament_table_id: "table-2", p_to_table_session_id: "session-2", p_to_seat_number: 3,
      p_expected_source_revision: 7, p_expected_destination_revision: 8, p_expected_source_epoch: 4,
      p_expected_destination_epoch: 5, p_reason: "Cân bàn", p_request_id: "request-1",
    });
  });

  it.each(["movePlayerSeatExact", "movePlayerSeatOrQueueExact"] as const)("%s never falls back to a weaker move RPC when the exact writer is disabled", async (operation) => {
    const rpc = vi.fn();
    const client = createFloorTableControlV3Client(rpc, { enabled: false });
    expect(await client[operation]({ entryId: "entry-1", fromTournamentTableId: "table-1", fromTableSessionId: "session-1",
      toTournamentTableId: "table-2", toTableSessionId: "session-2", toSeatNumber: 3,
      expectedSourceRevision: 7, expectedDestinationRevision: 8, expectedSourceEpoch: 4, expectedDestinationEpoch: 5,
      reason: "Cân bàn", requestId: "request-1" })).toEqual({ ok: false, error: "FLOOR_TABLE_CONTROL_V3_DISABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the exact orphan repair owner-gated and fail-closed", () => {
    expect(repairRunbook).toContain("21236017-8cf8-4997-ab0f-c5baa4ccb650");
    expect(repairRunbook).toContain("FLOOR_V3_ORPHAN_REPAIR_PREFLIGHT_CHANGED");
    expect(repairRunbook).toMatch(/NOT EXISTS \(\s+SELECT 1 FROM public\.tournament_seats/);
    expect(repairRunbook).not.toMatch(/DELETE\s+FROM/i);
  });
});

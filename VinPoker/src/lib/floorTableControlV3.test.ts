import { describe, expect, it, vi } from "vitest";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc } from "./floorTableControlV3";

describe("manual participation waiting contract", () => {
  const manualWaiting = { entry_id: "entry-manual", player_id: "player-manual", entry_no: 1,
    display_name: "Manual TEST", current_stack: 20000, registration_id: null };
  it("accepts a server-authorized manual entry without inventing registration identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: [manualWaiting] });
    expect(await clientFrom(rpc).getSeatableEntries("tour-a")).toEqual({ ok: true, data: [{
      entryId: "entry-manual", playerId: "player-manual", entryNo: 1,
      displayName: "Manual TEST", currentStack: 20000, registrationId: null,
    }] });
  });
  it.each([undefined, "", 7])("rejects malformed optional registration %s", async (registration_id) => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: [{ ...manualWaiting, registration_id }] });
    expect(await clientFrom(rpc).getSeatableEntries("tour-a"))
      .toEqual({ ok: false, error: "V3_SEATABLE_ENTRY_MALFORMED" });
  });
});

const inventoryRow = {
  game_table_id: "table-5",
  table_number: 5,
  table_name: "Bàn 5",
  operational_status: "available",
  availability_status: "available",
  table_session_id: null,
  session_type: null,
  control_mode: null,
  control_epoch: null,
  revision: null,
  tournament_id: null,
  tournament_table_id: null,
  tournament_table_status: null,
  active_dealer_assignment_id: null,
};

const rosterRow = {
  tournament_id: "tournament-a",
  tournament_table_id: "assignment-a",
  game_table_id: "table-5",
  table_number: 5,
  table_name: "Bàn 5",
  table_session_id: "session-a",
  session_revision: 4,
  control_mode: "manual",
  control_epoch: 1,
  tournament_table_status: "active",
  session_closed_at: null,
  active_dealer_assignment_id: null,
  seats: [{
    seat_number: 1,
    entry_id: "entry-a",
    player_id: "player-a",
    display_name: "Player A",
    entry_no: 1,
    chip_count: 30000,
    is_active: true,
    integrity_status: "valid",
  }],
};

const rosterV4Row = {
  ...rosterRow,
  max_seats: 8,
  seat_locks: [{
    seat_number: 8,
    reason: "Giữ ghế cho vận hành",
    locked_at: "2026-09-15T12:00:00.000Z",
    locked_by: "operator-a",
  }],
};

function clientFrom(handler: ReturnType<typeof vi.fn>, enabled = true, redrawSeatLockEnabled = false) {
  return createFloorTableControlV3Client(handler as unknown as FloorTableControlV3Rpc, { enabled, redrawSeatLockEnabled });
}

describe("floorTableControlV3 browser boundary", () => {
  it("accepts an orphan session as explicit repair data rather than dropping the whole room", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: [{ ...inventoryRow,
      availability_status: "repair_required", table_session_id: "orphan-session", session_type: "tournament",
      tournament_id: "tour-a", control_mode: "manual", control_epoch: 1, revision: 1,
    }] });
    const result = await clientFrom(rpc).getClubTableInventory("club-a");
    expect(result).toEqual({ ok: true, data: [expect.objectContaining({ availabilityStatus: "repair_required", tournamentTableId: null })] });
  });
  it("sends exact session, epoch and revision when requesting a mode change", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: { ok: true, outcome: "pending" } });
    await clientFrom(rpc).requestTableControlMode({ tournamentTableId: "table-a", tableSessionId: "session-a", controlMode: "manual", expectedRevision: 4, expectedEpoch: 2, requestId: "request-a" });
    expect(rpc).toHaveBeenCalledWith("floor_request_table_control_mode_v4", {
      p_tournament_table_id: "table-a", p_table_session_id: "session-a", p_control_mode: "manual",
      p_expected_revision: 4, p_expected_epoch: 2, p_request_id: "request-a",
    });
  });
  it("shows valid incomplete break rows as blockers instead of malformed data", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: {
      ok: true, complete: false, plan_hash: "hash", source_tournament_table_id: "table-a",
      source_table_number: 1, expected_revision: 4,
      moves: [
        { entry_id: null, player_name: "Legacy", source_seat_number: 1, destination_tournament_table_id: null },
        { entry_id: "entry-b", player_name: "Waiting", source_seat_number: 2, destination_tournament_table_id: null },
      ],
    } });
    const result = await clientFrom(rpc, true, true).planBreakTable({ tournamentTableId: "table-a", expectedRevision: 4, drawMode: "fill_lowest_table" });
    expect(result).toEqual({ ok: true, data: expect.objectContaining({ complete: false, moves: [], blockers: [
      { playerName: "Legacy", sourceSeatNumber: 1, reason: "missing_entry" },
      { playerName: "Waiting", sourceSeatNumber: 2, reason: "no_destination" },
    ] }) });
  });

  it("rejects a complete break plan containing unresolved identities", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: {
      ok: true, complete: true, plan_hash: "hash", source_tournament_table_id: "table-a",
      source_table_number: 1, expected_revision: 4,
      moves: [{ entry_id: null, player_name: "Legacy", source_seat_number: 1, destination_tournament_table_id: null }],
    } });
    await expect(clientFrom(rpc, true, true).planBreakTable({ tournamentTableId: "table-a", expectedRevision: 4, drawMode: "fill_lowest_table" }))
      .resolves.toEqual({ ok: false, error: "V3_BREAK_PLAN_MALFORMED" });
  });
  it("fails closed without any RPC while V3 is OFF", async () => {
    const rpc = vi.fn();
    const client = clientFrom(rpc, false);

    const result = await client.openTournamentTable({
      tournamentId: "tournament-a",
      gameTableId: "table-5",
      controlMode: "manual",
      requestId: "request-a",
    });

    expect(result).toEqual({ ok: false, error: "FLOOR_TABLE_CONTROL_V3_DISABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the fixed V3 inventory RPC and rejects duplicate physical inventory", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [inventoryRow, { ...inventoryRow, game_table_id: "table-5-duplicate" }], error: null });
    const client = clientFrom(rpc);

    await expect(client.getClubTableInventory("club-a")).resolves.toEqual({
      ok: false,
      error: "V3_INVENTORY_DUPLICATE_PHYSICAL_TABLE",
    });
    expect(rpc).toHaveBeenCalledWith("get_club_table_inventory", { p_club_id: "club-a" });
  });

  it("rejects malformed inventory rather than guessing an active table session", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ ...inventoryRow, availability_status: "in_use", table_session_id: null }], error: null });
    const client = clientFrom(rpc);

    await expect(client.getClubTableInventory("club-a")).resolves.toEqual({
      ok: false,
      error: "V3_INVENTORY_ROW_INCONSISTENT",
    });
  });

  it("quarantines every unnumbered inactive inventory row without hiding it", async () => {
    const dormant = { ...inventoryRow, game_table_id: "df74d2ca-f319-497b-8c7a-23eb39ff0cee", table_name: "Bàn TEST 1", table_number: null,
      operational_status: null, availability_status: "preflight_required" };
    const rpc = vi.fn().mockResolvedValue({ data: [dormant, inventoryRow], error: null });
    const client = clientFrom(rpc);

    await expect(client.getClubTableInventory("club-a")).resolves.toEqual({
      ok: true,
      data: [
        expect.objectContaining({ gameTableId: dormant.game_table_id, tableNumber: null, availabilityStatus: "preflight_required" }),
        expect.objectContaining({ gameTableId: "table-5", tableNumber: 5 }),
      ],
    });

    rpc.mockResolvedValue({ data: [{ ...dormant, table_session_id: "active-session", availability_status: "in_use" }], error: null });
    await expect(client.getClubTableInventory("club-a")).resolves.toEqual({
      ok: false,
      error: "V3_INVENTORY_ROW_INCONSISTENT",
    });

    rpc.mockResolvedValue({ data: [{ ...dormant, game_table_id: "another-unnumbered-table" }], error: null });
    await expect(client.getClubTableInventory("club-a")).resolves.toMatchObject({ ok: true, data: [expect.objectContaining({ tableNumber: null })] });

    rpc.mockResolvedValue({ data: [dormant, { ...dormant, game_table_id: "another-unnumbered-table" }], error: null });
    await expect(client.getClubTableInventory("club-a")).resolves.toMatchObject({ ok: true, data: [
      expect.objectContaining({ tableNumber: null }), expect.objectContaining({ tableNumber: null }),
    ] });

    rpc.mockResolvedValue({ data: [{ ...dormant, operational_status: "disabled", availability_status: "disabled" }], error: null });
    await expect(client.getClubTableInventory("club-a")).resolves.toMatchObject({ ok: true, data: [
      expect.objectContaining({ tableNumber: null, availabilityStatus: "disabled" }),
    ] });

    rpc.mockResolvedValue({ data: [{ ...dormant, operational_status: "available", availability_status: "available" }], error: null });
    await expect(client.getClubTableInventory("club-a")).resolves.toEqual({ ok: false, error: "V3_INVENTORY_ROW_INCONSISTENT" });
  });

  it("sends a caller-provided idempotency receipt when opening a physical table", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, table_session_id: "session-a" }, error: null });
    const client = clientFrom(rpc);

    await expect(client.openTournamentTable({
      tournamentId: "tournament-a",
      gameTableId: "table-5",
      controlMode: "tracker",
      requestId: "request-a",
    })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("floor_open_tournament_table_v3", {
      p_tournament_id: "tournament-a",
      p_game_table_id: "table-5",
      p_control_mode: "tracker",
      p_request_id: "request-a",
    });
  });

  it("sends the complete stale-state fence for Free Sit", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, waiting_status: "registered" }, error: null });
    const client = clientFrom(rpc);

    await expect(client.freeSitPlayer({
      entryId: "entry-a",
      expectedRevision: 4,
      expectedControlEpoch: 2,
      expectedChipCount: 62500,
      requestId: "request-free-sit",
      reason: "floor_v3_operator_free_sit",
    })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("floor_free_sit_player_v1", {
      p_entry_id: "entry-a",
      p_expected_revision: 4,
      p_expected_control_epoch: 2,
      p_expected_chip_count: 62500,
      p_request_id: "request-free-sit",
      p_reason: "floor_v3_operator_free_sit",
    });
  });

  it("requires the Tracker fencing tuple instead of only a table id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = clientFrom(rpc);

    await client.validateTrackerContext({
      tournamentId: "tournament-a",
      tournamentTableId: "assignment-a",
      tableSessionId: "session-a",
      controlEpoch: 3,
    });
    expect(rpc).toHaveBeenCalledWith("validate_tracker_table_writer_context_v3", {
      p_tournament_id: "tournament-a",
      p_tournament_table_id: "assignment-a",
      p_table_session_id: "session-a",
      p_control_epoch: 3,
    });
  });

  it("uses the fixed canonical roster RPC and rejects duplicate active seats", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...rosterRow, seats: [rosterRow.seats[0], { ...rosterRow.seats[0], entry_id: "entry-b" }] }],
      error: null,
    });
    const client = clientFrom(rpc);

    await expect(client.getTournamentTableRoster("tournament-a")).resolves.toEqual({
      ok: false,
      error: "V3_ROSTER_SEAT_DUPLICATE",
    });
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v3", { p_tournament_id: "tournament-a" });
  });

  it("fails closed for a mixed-session roster row", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...rosterRow, session_closed_at: "2026-08-27T00:00:00.000Z" }],
      error: null,
    });
    const client = clientFrom(rpc);

    await expect(client.getTournamentTableRoster("tournament-a")).resolves.toEqual({
      ok: false,
      error: "V3_ROSTER_ROW_MALFORMED",
    });
  });

  it("uses the tournament-scoped inventory contract for table pickers", async () => {
    const scopedRow = {
      game_table_id: "table-6",
      table_number: 6,
      table_name: "Bàn 6",
      operational_status: "available",
      availability_status: "available",
      table_session_id: null,
      control_mode: null,
      control_epoch: null,
      revision: null,
      tournament_table_id: null,
      max_seats: null,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [scopedRow], error: null });
    const client = clientFrom(rpc, true, true);

    await expect(client.getTournamentTableInventory("tournament-a")).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_inventory_v1", { p_tournament_id: "tournament-a" });
  });

  it("keeps unnumbered tables visible as preflight-only in tournament inventory", async () => {
    const dormant = {
      game_table_id: "df74d2ca-f319-497b-8c7a-23eb39ff0cee", table_number: null, table_name: "Bàn TEST 1",
      operational_status: null, availability_status: "preflight_required",
      table_session_id: null, control_mode: null, control_epoch: null,
      revision: null, tournament_table_id: null, max_seats: null,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [dormant], error: null });
    const client = clientFrom(rpc, true, true);
    await expect(client.getTournamentTableInventory("tournament-a")).resolves.toMatchObject({
      ok: true, data: [expect.objectContaining({ tableNumber: null, availabilityStatus: "preflight_required" })],
    });

    rpc.mockResolvedValue({ data: [{ ...dormant, table_session_id: "active-session", availability_status: "current_tournament" }], error: null });
    await expect(client.getTournamentTableInventory("tournament-a")).resolves.toEqual({
      ok: false,
      error: "V3_TOURNAMENT_INVENTORY_ROW_INCONSISTENT",
    });
  });

  it("parses an 8-max roster with an empty locked seat", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [rosterV4Row], error: null });
    const client = clientFrom(rpc, true, true);

    await expect(client.getTournamentTableRoster("tournament-a")).resolves.toEqual({
      ok: true,
      data: [expect.objectContaining({ maxSeats: 8, seatLocks: [expect.objectContaining({ seatNumber: 8 })] })],
    });
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v6", { p_tournament_id: "tournament-a" });
  });

  it("routes seat assignment and table lifecycle writes through the lock-aware contracts", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = clientFrom(rpc, true, true);

    await client.assignEntryToSeat({
      entryId: "entry-a",
      tournamentTableId: "assignment-a",
      seatNumber: 3,
      expectedRevision: 4,
      requestId: "request-seat",
    });
    await client.breakTournamentTable({
      tournamentTableId: "assignment-a",
      expectedRevision: 4,
      requestId: "request-break",
      drawMode: "fill_lowest_table",
      planHash: "plan-hash-a",
    });
    await client.closeTournamentTable({
      tournamentTableId: "assignment-a",
      expectedRevision: 4,
      requestId: "request-close",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "floor_assign_entry_to_seat_v4", expect.any(Object));
    expect(rpc).toHaveBeenNthCalledWith(2, "floor_break_table_v5", expect.objectContaining({ p_plan_hash: "plan-hash-a" }));
    expect(rpc).toHaveBeenNthCalledWith(3, "close_tournament_table_v4", expect.any(Object));
  });

  it("keeps the flag-off break flow on the legacy RPC without a plan hash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = clientFrom(rpc, true, false);

    await client.breakTournamentTable({
      tournamentTableId: "assignment-a",
      expectedRevision: 4,
      requestId: "request-break-legacy",
      drawMode: "fill_lowest_table",
    });

    expect(rpc).toHaveBeenCalledWith("floor_break_table_v3", {
      p_tournament_table_id: "assignment-a",
      p_expected_revision: 4,
      p_request_id: "request-break-legacy",
      p_draw_mode: "fill_lowest_table",
    });
  });

  it("persists a redraw preview and applies the exact batch id", async () => {
    const planned = {
      ok: true,
      batch_id: "batch-a",
      status: "planned",
      target_max_seats: 8,
      target_table_count: 1,
      player_count: 1,
      moved_count: 1,
      moves: [{
        entry_id: "entry-a",
        player_name: "Player A",
        from_table_number: 5,
        from_seat_number: 1,
        to_table_number: 6,
        to_seat_number: 1,
      }],
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: planned, error: null })
      .mockResolvedValueOnce({ data: { ...planned, status: "applied" }, error: null });
    const client = clientFrom(rpc, true, true);

    const preview = await client.planTournamentRedraw({
      tournamentId: "tournament-a",
      targetMaxSeats: 8,
      gameTableIds: ["table-6"],
      requestId: "request-plan",
    });
    expect(preview).toMatchObject({ ok: true, data: { batchId: "batch-a", status: "planned" } });
    const applied = await client.applyTournamentRedraw({ batchId: "batch-a", requestId: "request-apply" });
    expect(applied).toMatchObject({ ok: true, data: { batchId: "batch-a", status: "applied" } });
    expect(rpc).toHaveBeenLastCalledWith("floor_apply_tournament_redraw_v1", {
      p_batch_id: "batch-a",
      p_request_id: "request-apply",
    });
  });

  it("continues the active immutable batch using its server revision and an idempotency key", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { batch_id: "batch-a", redraw_revision: 1, moves: [] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, batch_id: "batch-a", redraw_revision: 2, clock_resumed: true }, error: null });
    const client = clientFrom(rpc, true, true);

    const active = await client.getActiveTournamentRedraw("tournament-a");
    expect(active).toEqual({ ok: true, data: { batchId: "batch-a", redrawRevision: 1 } });
    const continued = await client.continueTournamentRedraw({
      batchId: "batch-a",
      expectedRedrawRevision: active.ok ? active.data?.redrawRevision ?? 0 : 0,
      requestId: "continue-request-a",
    });

    expect(continued).toEqual({ ok: true, data: { clockResumed: true } });
    expect(rpc).toHaveBeenNthCalledWith(1, "get_public_tournament_redraw_v1", {
      p_tournament_id: "tournament-a",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "floor_continue_tournament_redraw_v1", {
      p_batch_id: "batch-a",
      p_expected_redraw_revision: 1,
      p_request_id: "continue-request-a",
    });
  });

  it("makes no RPC when redraw and seat locking are dark", async () => {
    const rpc = vi.fn();
    const client = clientFrom(rpc, true, false);

    await expect(client.setSeatLock({
      tournamentTableId: "assignment-a",
      seatNumber: 2,
      locked: true,
      reason: "hold",
      expectedRevision: 4,
      requestId: "request-lock",
    })).resolves.toEqual({ ok: false, error: "FLOOR_REDRAW_SEAT_LOCK_V1_DISABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, expect, it } from "vitest";
import { FloorTableMapPanelV3 } from "@/components/cashier/tournament-live/FloorTableMapPanelV3";
import type { Tournament } from "@/types/tournament";

const fixture = vi.hoisted(() => ({
  actor: "owner-a",
  supabase: { rpc: vi.fn() },
  successToast: vi.fn(),
  errorToast: vi.fn(),
  moveDialog: vi.fn(),
  longName: "CODEX_FLOOR_UAT_20260724114346_7ff93193_CASHIER",
  client: {
    enabled: true,
    getTournamentTableRoster: vi.fn(),
    getSeatableEntries: vi.fn(),
    getRestorableEntries: vi.fn(),
    getPendingTrackerMoves: vi.fn(),
    getTableControlModeRequest: vi.fn(),
    requestTableControlMode: vi.fn(),
    cancelTableControlModeRequest: vi.fn(),
    movePlayerSeat: vi.fn(),
    queueTrackerMove: vi.fn(),
    cancelPendingTrackerMove: vi.fn(),
    planBreakTable: vi.fn(),
    breakTournamentTable: vi.fn(),
    redrawSeatLockEnabled: true,
    deferredTrackerMoveEnabled: true,
  },
}));

vi.mock("sonner", () => ({ toast: { success: fixture.successToast, error: fixture.errorToast } }));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => fixture.supabase }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: fixture.actor } }) }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => fixture.client }));
vi.mock("@/components/ops/shared/FloorTableRosterIndex", () => ({
  FloorTableRosterIndex: ({ onOpen }: { onOpen: (id: string) => void }) =>
    <button onClick={() => onOpen("table-1")}>Mở Bàn 4</button>,
}));
vi.mock("@/components/ops/shared/FloorSeatRoster", () => ({
  FloorSeatRoster: ({ onSeatTap }: { onSeatTap: (seat: number) => void }) =>
    <button onClick={() => onSeatTap(1)}>Mở Ghế 1</button>,
}));
vi.mock("@/components/cashier/tournament-live/OpenTableDialog", () => ({ OpenTableDialog: () => null }));
vi.mock("@/components/cashier/tournament-live/FloorRedrawDialogV1", () => ({ FloorRedrawDialogV1: () => null }));
vi.mock("@/components/cashier/tournament-live/MovePlayerDialog", () => ({ MovePlayerDialog: (props: {
  open: boolean; entryId: string; actorId: string | null; onMoved: () => void;
}) => {
  fixture.moveDialog(props);
  return props.open ? <div data-testid="canonical-move-host">{props.actorId}:{props.entryId}
    <button onClick={props.onMoved}>Đặt chờ canonical</button></div> : null;
} }));

function setup(options: { pendingNetworkFailure?: boolean } = {}) {
  vi.clearAllMocks();
  sessionStorage.clear();
  fixture.actor = "owner-a";
  fixture.client.getTournamentTableRoster.mockResolvedValue({ ok: true, data: [{
    tournamentId: "tour-1", tournamentTableId: "table-1", gameTableId: "physical-1",
    tableNumber: 4, tableName: "Bàn 4", tableSessionId: "session-1",
    sessionRevision: 3, controlMode: "manual", controlEpoch: 1,
    maxSeats: 9, tournamentTableStatus: "active", sessionClosedAt: null,
    activeDealerAssignmentId: null, seatLocks: [], seats: [{
      seatNumber: 1, entryId: "entry-1", playerId: "player-1",
      displayName: fixture.longName, entryNo: 1, chipCount: 30_000_000, isActive: true, integrityStatus: "valid",
    }],
  }, {
    tournamentId: "tour-1", tournamentTableId: "table-2", gameTableId: "physical-2",
    tableNumber: 5, tableName: "Bàn 5", tableSessionId: "session-2",
    sessionRevision: 4, controlMode: "tracker", controlEpoch: 1,
    maxSeats: 9, tournamentTableStatus: "active", sessionClosedAt: null,
    activeDealerAssignmentId: null, seatLocks: [], seats: [],
  }] });
  fixture.client.getSeatableEntries.mockResolvedValue({ ok: true, data: [] });
  fixture.client.getRestorableEntries.mockResolvedValue({ ok: true, data: [] });
  fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: { request: null } });
  fixture.client.requestTableControlMode.mockResolvedValue({ ok: true, data: { outcome: "applied" } });
  fixture.client.cancelTableControlModeRequest.mockResolvedValue({ ok: true, data: { outcome: "cancelled" } });
  if (options.pendingNetworkFailure) fixture.client.getPendingTrackerMoves.mockRejectedValue(new Error("offline"));
  else fixture.client.getPendingTrackerMoves.mockResolvedValue({ ok: true, data: [] });
  fixture.client.planBreakTable.mockResolvedValue({ ok: true, data: {
    planHash: "plan-hash-1", complete: true,
    sourceTournamentTableId: "table-1", sourceTableNumber: 4, expectedRevision: 3,
    moves: [{
      entryId: "entry-1", playerName: fixture.longName, sourceSeatNumber: 1,
      destinationTournamentTableId: "table-2", destinationTableNumber: 5,
      destinationSeatNumber: 2, transferMode: "after_current_hand",
    }],
  } });
  fixture.client.breakTournamentTable.mockResolvedValue({ ok: true, data: { ok: true, break_pending: true } });
  return render(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={0} />);
}

async function openTableSheet() {
  const open = await screen.findByRole("button", { name: "Mở Bàn 4" });
  await act(async () => { fireEvent.click(open); });
  await screen.findByRole("button", { name: /(?:Manual Floor|Live Tracker).*Đổi chế độ/ });
}
async function selectTrackerMode() {
  const picker = await screen.findByTestId("floor-table-control-mode-tracker");
  await waitFor(() => expect(picker).not.toBeDisabled());
  await act(async () => { fireEvent.click(picker); });
}
async function submitMode() {
  let confirm = screen.queryByRole("button", { name: "Xác nhận đổi chế độ" });
  if (!confirm) {
    const save = screen.getByTestId("floor-table-control-mode-save");
    await waitFor(() => expect(save).not.toBeDisabled());
    await act(async () => { fireEvent.click(save); });
    confirm = await screen.findByRole("button", { name: "Xác nhận đổi chế độ" });
  }
  await waitFor(() => expect(confirm).not.toBeDisabled());
  await act(async () => { fireEvent.click(confirm!); });
}

describe("Floor roster mobile actions", () => {
  it("does not expose mutation controls for invalid participation even if a stale seat selection arrives", async () => {
    const view = setup();
    try {
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
        (table: { seats: object[] }) => ({ ...table, seats: table.seats.map((seat) => ({ ...seat, integrityStatus: "invalid_participation" })) }),
      ) });
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
      expect(screen.getByText(/Dữ liệu người chơi, phiên bàn hoặc chip chưa khớp/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Chuyển người" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rời ghế" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Loại khỏi giải" })).toBeNull();
      expect(fixture.supabase.rpc).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it.each(["free-sit", "close", "break"])("invalidates the %s confirmation instead of adopting a newer revision", async (operation) => {
    const view = setup();
    try {
      if (operation === "close") {
        const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
        fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
          (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1" ? { ...table, seats: [] } : table,
        ) });
      }
      await openTableSheet();
      const confirmName = operation === "free-sit" ? "Xác nhận rời ghế"
        : operation === "close" ? "Xác nhận đóng bàn" : "Xác nhận đóng & chuyển";
      if (operation === "free-sit") {
        fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
        fireEvent.click(screen.getByRole("button", { name: "Rời ghế" }));
      } else fireEvent.click(screen.getByRole("button", { name: operation === "close" ? "Đóng bàn trống" : "Đóng & chuyển người" }));
      await screen.findByRole("button", { name: confirmName });
      const roster = await fixture.client.getTournamentTableRoster.mock.results.at(-1)!.value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster, data: roster.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1" ? { ...table, sessionRevision: 9 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      await waitFor(() => expect(screen.queryByRole("button", { name: confirmName })).toBeNull());
      await screen.findByText(/Revision 9 · epoch 1/);
      expect(screen.queryByRole("button", { name: confirmName })).toBeNull();
      expect(fixture.client.breakTournamentTable).not.toHaveBeenCalled();
      expect(fixture.supabase.rpc).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it.each(["session", "epoch"])("drops an open move intent on %s replacement", async (boundary) => {
    const view = setup();
    try {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Chuyển người" }));
      expect(screen.getByTestId("canonical-move-host")).toBeTruthy();
      const roster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster, data: roster.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, tableSessionId: boundary === "session" ? "new-session" : "session-1",
            sessionRevision: 9, controlEpoch: 4 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      await waitFor(() => expect(screen.queryByTestId("canonical-move-host")).toBeNull());
      expect(fixture.client.movePlayerSeat).not.toHaveBeenCalled();
      expect(fixture.client.queueTrackerMove).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it("discards a break preview delivered after session replacement", async () => {
    const view = setup();
    try {
      const plan = await fixture.client.planBreakTable.getMockImplementation()!();
      let resolvePlan!: (value: unknown) => void;
      fixture.client.planBreakTable.mockImplementationOnce(() => new Promise((resolve) => { resolvePlan = resolve; }));
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Đóng & chuyển người" }));
      await waitFor(() => expect(fixture.client.planBreakTable).toHaveBeenCalledTimes(1));
      const roster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster, data: roster.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, tableSessionId: "new-session", sessionRevision: 9, controlEpoch: 4 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      await screen.findByText(/Revision 9 · epoch 4/);
      await act(async () => resolvePlan(plan));
      expect(screen.queryByRole("button", { name: "Xác nhận đóng & chuyển" })).toBeNull();
      expect(fixture.client.breakTournamentTable).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it.each(["session", "epoch"])("invalidates an open bust confirmation when the table %s changes", async (boundary) => {
    const view = setup();
    try {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Loại khỏi giải" }));
      expect(screen.getByRole("button", { name: "Xác nhận loại" })).toBeTruthy();
      const roster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster, data: roster.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, tableSessionId: boundary === "session" ? "new-session" : "session-1",
            sessionRevision: 9, controlEpoch: 4 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      await waitFor(() => expect(screen.queryByRole("button", { name: "Xác nhận loại" })).toBeNull());
      expect(fixture.client.breakTournamentTable).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it("refreshes mode after pending completes while the table sheet is closed", async () => {
    const view = setup();
    try {
      fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: {
        request: { id: "mode-pending", target_mode: "tracker", blockers: ["active_hand"] },
      } });
      await openTableSheet();
      await waitFor(() => expect(fixture.client.getTournamentTableRoster).toHaveBeenCalledTimes(3));
      fireEvent.click(screen.getByRole("button", { name: "Đóng danh sách bàn" }));
      const roster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster, data: roster.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, controlMode: "tracker", sessionRevision: 8, controlEpoch: 2 } : table,
      ) });
      fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: { request: null } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mở Bàn 4" })); });
      await screen.findByText(/Revision 8 · epoch 2/);
      expect(screen.getByRole("button", { name: /Live Tracker.*Đổi chế độ/ })).toBeTruthy();
      expect(fixture.client.requestTableControlMode).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it("removes the old table's writers immediately when tournament scope changes", async () => {
    const view = setup();
    let finish!: (value: unknown) => void;
    try {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
      fixture.client.getTournamentTableRoster.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-2" } as Tournament} refreshTrigger={0} />);
      expect(screen.queryByRole("button", { name: "Mở Ghế 1" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Chuyển người" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Đóng & chuyển người" })).toBeNull();
      expect(fixture.client.movePlayerSeat).not.toHaveBeenCalled();
      expect(fixture.client.breakTournamentTable).not.toHaveBeenCalled();
    } finally {
      if (finish) await act(async () => { finish({ ok: true, data: [] }); });
      view.unmount();
    }
  });

  it.each(["manual", "tracker"])("reconciles the same immutable mode intent after response loss and a real remount with server mode %s", async (serverMode) => {
    sessionStorage.clear();
    const view = setup();
    let remounted: ReturnType<typeof render> | undefined;
    try {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      await selectTrackerMode();
      fixture.client.requestTableControlMode.mockRejectedValueOnce(new Error("response lost after commit"));
      await submitMode();
      await waitFor(() => expect(fixture.errorToast).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByRole("button", { name: "Xác nhận đổi chế độ" })).not.toBeDisabled());
      const original = fixture.client.requestTableControlMode.mock.calls[0][0];
      view.unmount();
      if (serverMode === "tracker") {
        const roster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
        fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster, data: roster.data.map(
          (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
            ? { ...table, controlMode: "tracker", sessionRevision: 8, controlEpoch: 2 } : table,
        ) });
      }
      // Do not call setup: preserve storage, server mocks and transport history.
      remounted = render(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={0} />);
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: /(?:Manual Floor|Live Tracker).*Đổi chế độ/ }));
      await submitMode();
      await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(2));
      expect(fixture.client.requestTableControlMode.mock.calls[1][0]).toEqual(original);
    } finally { view.unmount(); remounted?.unmount(); sessionStorage.clear(); }
  });

  it("does not announce success for an unknown mode mutation outcome", async () => {
    const view = setup();
    try {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      await selectTrackerMode();
      fixture.client.requestTableControlMode.mockResolvedValueOnce({ ok: true, data: { outcome: "unknown" } });
      await submitMode();
      await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(fixture.errorToast).toHaveBeenCalled());
      expect(fixture.successToast).not.toHaveBeenCalled();
      expect(fixture.errorToast).toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it.each(["pending", "closed", "wrong-session"])("validates a %s break receipt before announcing closure", async (outcome) => {
    const view = setup();
    try {
      fixture.client.breakTournamentTable.mockResolvedValue({ ok: true, data: {
        ok: true, tournament_table_id: "table-1",
        table_session_id: outcome === "wrong-session" ? "old-session" : "session-1",
        closed: outcome === "closed", break_pending: outcome !== "closed",
        moved_count: outcome === "closed" ? 1 : 0, pending_count: outcome === "closed" ? 0 : 1,
      } });
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Đóng & chuyển người" }));
      const confirm = await screen.findByRole("button", { name: "Xác nhận đóng & chuyển" });
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);
      await waitFor(() => expect(fixture.client.breakTournamentTable).toHaveBeenCalledTimes(1));
      if (outcome === "wrong-session") {
        await waitFor(() => expect(fixture.errorToast).toHaveBeenCalled());
        expect(screen.getByRole("button", { name: "Xác nhận đóng & chuyển" })).not.toBeDisabled();
        expect(fixture.successToast).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(fixture.successToast).toHaveBeenCalledWith(outcome === "pending"
          ? "Đã lưu yêu cầu chuyển người. Bàn còn mở đến khi các lượt chuyển hoàn tất."
          : "Đã đóng và chuyển người chơi."));
      }
    } finally { view.unmount(); }
  });

  it("ignores an earlier actor's delayed roster after the account changes", async () => {
    const view = setup();
    try {
      await openTableSheet();
      await screen.findByText(/Revision 3 · epoch 1/);
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      let finishOld!: (value: typeof initial) => void;
      fixture.client.getTournamentTableRoster.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, sessionRevision: 11, controlEpoch: 4 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-b" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      await openTableSheet();
      await screen.findByText(/Revision 11 · epoch 4/);
      await act(async () => { finishOld(initial); });
      expect(screen.getByText(/Revision 11 · epoch 4/)).toBeTruthy();
      expect(screen.queryByText(/Revision 3 · epoch 1/)).toBeNull();
    } finally { view.unmount(); }
  });

  it("does not reload roster on repeated null mode polls without an observed pending request", async () => {
    let poll: (() => void) | undefined;
    const interval = vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      if (delay === 4000 && typeof callback === "function") poll = callback as () => void;
      return 123;
    });
    const view = setup();
    try {
      await openTableSheet();
      await waitFor(() => expect(fixture.client.getTableControlModeRequest).toHaveBeenCalledTimes(1));
      await act(async () => { poll!(); });
      await act(async () => { poll!(); });
      expect(fixture.client.getTournamentTableRoster).toHaveBeenCalledTimes(2);
    } finally { view.unmount(); interval.mockRestore(); }
  });

  it("does not overwrite a newer roster with a delayed earlier refresh", async () => {
    const view = setup();
    try {
      await openTableSheet();
      await screen.findByText(/Revision 3 · epoch 1/);
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      let finishOld!: (value: typeof initial) => void;
      fixture.client.getTournamentTableRoster.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, sessionRevision: 9, controlEpoch: 3 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={2} />);
      await screen.findByText(/Revision 9 · epoch 3/);
      await act(async () => { finishOld(initial); });
      expect(screen.getByText(/Revision 9 · epoch 3/)).toBeTruthy();
      expect(screen.queryByText(/Revision 3 · epoch 1/)).toBeNull();
    } finally { view.unmount(); }
  });

  it.each(["open", "closed", "refresh-error"])("refreshes canonical roster at the hand boundary with picker %s", async (state) => {
    let poll: (() => void) | undefined;
    const interval = vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      if (delay === 4000 && typeof callback === "function") poll = callback as () => void;
      return 123;
    });
    const view = setup();
    try {
      fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: {
        request: { id: "mode-request-1", target_mode: "tracker", blockers: ["active_hand"] },
      } });
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      await waitFor(() => expect(fixture.client.getTournamentTableRoster).toHaveBeenCalledTimes(3));
      if (state === "closed") fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, controlMode: "tracker", sessionRevision: 4, controlEpoch: 2 } : table,
      ) });
      fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: { request: null } });
      if (state === "refresh-error") fixture.client.getTournamentTableRoster.mockRejectedValueOnce(new Error("offline"));
      expect(poll).toBeDefined();
      await act(async () => { poll!(); });
      if (state === "refresh-error") {
        await screen.findAllByText(/Không tải được danh sách bàn/);
        await act(async () => { poll!(); });
      }
      await screen.findByText(/Revision 4 · epoch 2/);
      expect(screen.getByRole("button", { name: /Live Tracker.*Đổi chế độ/ })).toBeTruthy();
    } finally {
      view.unmount();
      interval.mockRestore();
    }
  });

  it.each(["session", "actor"])("does not reuse another %s's unknown-outcome intent", async (scope) => {
    const view = setup();
    await openTableSheet();
    fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
    await selectTrackerMode();
    fixture.client.requestTableControlMode.mockRejectedValueOnce(new Error("response lost"));
    await submitMode();
    await waitFor(() => expect(fixture.errorToast).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Xác nhận đổi chế độ" })).not.toBeDisabled());
    const original = fixture.client.requestTableControlMode.mock.calls[0][0];
    if (scope === "session") {
      const roster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster,
        data: roster.data.map((table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, tableSessionId: "session-reopened", sessionRevision: 9, controlEpoch: 3 } : table),
      });
    }
    fixture.actor = scope === "actor" ? "owner-b" : "owner-a";
    view.rerender(<FloorTableMapPanelV3 actorId={scope === "actor" ? "owner-b" : "owner-a"}
      tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
    if (scope === "session") {
      await screen.findByText(/Revision 9 · epoch 3/);
      fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      await selectTrackerMode();
    }
    if (scope === "actor") {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      await selectTrackerMode();
    }
    await submitMode();
    await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(2));
    const retry = fixture.client.requestTableControlMode.mock.calls[1][0];
    expect(retry.requestId).not.toBe(original.requestId);
    if (scope === "session") expect(retry).toMatchObject({ tableSessionId: "session-reopened", expectedRevision: 9, expectedEpoch: 3 });
  });

  it.each(["network", "malformed", "backend"])("retains the exact retry intent after an ambiguous %s failure", async (failure) => {
    const view = setup();
    await openTableSheet();
    fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
    await selectTrackerMode();
    const initialRoster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
    fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initialRoster,
      data: initialRoster.data.map((table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
        ? { ...table, sessionRevision: 8, controlEpoch: 2 } : table),
    });
    if (failure === "network") fixture.client.requestTableControlMode.mockRejectedValueOnce(new Error("response lost"));
    else fixture.client.requestTableControlMode.mockResolvedValueOnce({ ok: false,
      error: failure === "malformed" ? "V3_MUTATION_RESPONSE_MALFORMED" : "Failed to fetch" });
    await submitMode();
    await waitFor(() => expect(fixture.errorToast).toHaveBeenCalled());
    // Refresh may supply newer fences, but receipt replay must keep old bytes.
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
    await screen.findByText(/Revision 8 · epoch 2/);
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-save")).not.toBeDisabled());
    const firstIntent = fixture.client.requestTableControlMode.mock.calls[0][0];
    await submitMode();
    await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(2));
    expect(fixture.client.requestTableControlMode.mock.calls[1][0]).toEqual(firstIntent);
  });

  it("uses fresh fences for an explicit retry after a definitive stale rejection", async () => {
    setup();
    await openTableSheet();
    fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
    await selectTrackerMode();
    const initialRoster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
    fixture.client.getTournamentTableRoster.mockResolvedValue({
      ...initialRoster,
      data: initialRoster.data.map((table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
        ? { ...table, sessionRevision: 8, controlEpoch: 2 } : table),
    });
    fixture.client.requestTableControlMode.mockResolvedValueOnce({ ok: false, error: "STALE_STATE" });
    await submitMode();
    await waitFor(() => expect(fixture.errorToast).toHaveBeenCalled());
    await screen.findByText(/Revision 8 · epoch 2/);
    await selectTrackerMode();
    const firstIntent = fixture.client.requestTableControlMode.mock.calls[0][0];
    await submitMode();
    await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(2));
    const secondIntent = fixture.client.requestTableControlMode.mock.calls[1][0];
    expect(secondIntent).toMatchObject({ expectedRevision: 8, expectedEpoch: 2, tableSessionId: "session-1", controlMode: "tracker" });
    expect(secondIntent.requestId).not.toBe(firstIntent.requestId);
  });

  it("hands the scoped entry to the canonical dialog instead of inline legacy writers", async () => {
    setup();
    await openTableSheet();
    fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
    expect(screen.queryByLabelText("Bàn đích")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chuyển người" }));
    expect(screen.getByTestId("canonical-move-host")).toHaveTextContent("owner-a:entry-1");
    expect(fixture.moveDialog).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: "owner-a",
      tournamentId: "tour-1", entryId: "entry-1", currentTournamentTableId: "table-1", currentSeatNumber: 1 }));
    expect(fixture.client.movePlayerSeat).not.toHaveBeenCalled();
    expect(fixture.client.queueTrackerMove).not.toHaveBeenCalled();
  });

  it("keeps long names inside Vietnamese action dialogs", async () => {
    setup();
    await openTableSheet();
    fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Loại khỏi giải" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(fixture.longName).className).toContain("break-all");
    expect(dialog.className).toContain("operations-typography");
    expect(dialog.className).toContain("w-[calc(100vw-2rem)]");
    fireEvent.click(within(dialog).getByRole("button", { name: "Giữ người chơi" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Rời ghế" }));
    expect(within(screen.getByRole("alertdialog")).getByText(/giữ nguyên chip và trở về danh sách chờ/)).toBeTruthy();
  });

  it("refreshes and displays the reserved seat after the canonical dialog acknowledges pending", async () => {
    setup();
    await openTableSheet();
    fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Chuyển người" }));
    fixture.client.getPendingTrackerMoves.mockResolvedValue({ ok: true, data: [{
      pendingMoveId: "pending-1", entryId: "entry-1", sourceTournamentTableId: "table-1",
      destinationTournamentTableId: "table-2", destinationSeatNumber: 2,
      status: "pending", resolutionReason: null, requestedAt: "2026-09-24T00:00:00Z",
    }] });
    fireEvent.click(within(screen.getByTestId("canonical-move-host")).getByRole("button", { name: "Đặt chờ canonical", hidden: true }));
    expect(fixture.client.queueTrackerMove).not.toHaveBeenCalled();
    expect(fixture.client.movePlayerSeat).not.toHaveBeenCalled();
    expect(await screen.findByText("Chờ hết ván · Bàn 5 · Ghế 2")).toBeTruthy();
  });

  it("keeps the result dialog mounted when the moved player leaves the source roster", async () => {
    const view = setup();
    try {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Chuyển người" }));
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial,
        data: initial.data.map((table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, seats: [] } : table) });
      fireEvent.click(within(screen.getByTestId("canonical-move-host")).getByRole("button", { name: "Đặt chờ canonical", hidden: true }));
      await waitFor(() => expect(fixture.client.getTournamentTableRoster).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(screen.queryByLabelText("Thao tác người chơi")).toBeNull());
      expect(screen.getByTestId("canonical-move-host")).toHaveTextContent("owner-a:entry-1");
    } finally { view.unmount(); }
  });
  it("does not carry an open move dialog across an actor change", async () => {
    const view = setup();
    try {
      await openTableSheet();
      fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Chuyển người" }));
      expect(screen.getByTestId("canonical-move-host")).toHaveTextContent("owner-a:entry-1");
      view.rerender(<FloorTableMapPanelV3 actorId="owner-b" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={0} />);
      expect(screen.queryByTestId("canonical-move-host")).toBeNull();
      expect(fixture.client.movePlayerSeat).not.toHaveBeenCalled();
      expect(fixture.client.queueTrackerMove).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("keeps the roster usable when a secondary request fails", async () => {
    setup({ pendingNetworkFailure: true });
    expect(await screen.findByRole("button", { name: "Mở Bàn 4" })).toBeTruthy();
    expect(screen.getByText(/Danh sách bàn vẫn hiển thị/)).toBeTruthy();
    await openTableSheet();
    expect(screen.getByRole("button", { name: "Mở Ghế 1" })).toBeTruthy();
  });

  it("shows the server break plan before allowing a close", async () => {
    setup();
    await openTableSheet();
    fireEvent.click(screen.getByRole("button", { name: "Đóng & chuyển người" }));
    expect(await screen.findByText(/Bàn 5 · Ghế 2/)).toBeTruthy();
    expect(screen.getByText("Chuyển sau ván")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đóng & chuyển" }));
    await waitFor(() => expect(fixture.client.breakTournamentTable).toHaveBeenCalledWith(expect.objectContaining({
      tournamentTableId: "table-1",
      planHash: "plan-hash-1",
    })));
  });
});

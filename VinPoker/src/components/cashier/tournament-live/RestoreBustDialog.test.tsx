import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorTournamentTableRoster } from "@/lib/floorTableControlV3";
const state = vi.hoisted(() => ({ user: { id: "owner-a" }, roster: vi.fn(), entries: vi.fn(), restore: vi.fn(), receipt: vi.fn(), cancel: vi.fn(), supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => state.supabase }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => ({
  getTournamentTableRoster: state.roster, getRestorableEntries: state.entries, restoreBustedPlayer: state.restore, getRestoreReceipt: state.receipt, cancelRestoreRequest: state.cancel,
}) }));
import { RestoreBustDialog } from "./RestoreBustDialog";
const target = { entryId: "entry-a", name: "TEST Alice" };
const canonicalReceipt = { ok: true, entry_id: "entry-a", tournament_table_id: "tt-a", table_session_id: "session-a",
  seat_number: 1, seat_id: "seat-a", chip_count: 25000, revision: 8, payout_applied: false };
const table: FloorTournamentTableRoster = {
  tournamentId: "tour-a", tournamentTableId: "tt-a", gameTableId: "physical-a", tableNumber: 1, tableName: "Bàn TEST 1",
  tableSessionId: "session-a", sessionRevision: 7, controlMode: "manual", controlEpoch: 2, maxSeats: 8,
  tournamentTableStatus: "active", sessionClosedAt: null, activeDealerAssignmentId: null,
  seats: [], seatLocks: [{ seatNumber: 2, reason: "TEST lock", lockedAt: "2026-10-09T00:00:00Z", lockedBy: "owner-a" }],
};
function mount() {
  const onRestored = vi.fn(); const onClose = vi.fn();
  const view = render(<RestoreBustDialog actorId="owner-a" tournamentId="tour-a" target={target} onRestored={onRestored} onClose={onClose} />);
  return { ...view, onRestored, onClose };
}
async function choose() {
  await screen.findByText(/25,000|25.000|25 000/);
  fireEvent.change(screen.getByLabelText("Bàn khôi phục"), { target: { value: "tt-a" } });
  fireEvent.change(screen.getByLabelText("Ghế khôi phục"), { target: { value: "1" } });
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks(); state.user = { id: "owner-a" };
  state.roster.mockResolvedValue({ ok: true, data: [table] });
  state.entries.mockResolvedValue({ ok: true, data: [{ entryId: "entry-a", currentStack: 25000 }] });
  state.restore.mockResolvedValue({ ok: true, data: canonicalReceipt });
  state.receipt.mockResolvedValue({ ok: true, data: { status: "unknown" } });
});
afterEach(() => { vi.useRealTimers(); cleanup(); });
describe("mistaken-bust restore", () => {
  it("ends a hung evidence read without enabling mutation or accepting late roster", async () => {
    let complete!: (value: unknown) => void;
    state.roster.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    vi.useFakeTimers();
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20001); });
    expect(screen.getByRole("alert")).toHaveTextContent("Không kết nối được server");
    expect(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" })).toBeDisabled();
    await act(async () => { complete({ ok: true, data: [table] }); });
    expect(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" })).toBeDisabled();
    expect(state.restore).not.toHaveBeenCalled();
  });
  it.each(["restore", "receipt", "cancel"] as const)("unfreezes hung %s without forgetting its intent or accepting late success", async (operation) => {
    const view = mount(); await choose();
    if (operation !== "restore") {
      state.restore.mockRejectedValueOnce(new Error("unknown commit"));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
      await screen.findByRole("alert");
    }
    let complete!: (value: unknown) => void;
    state[operation].mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: operation === "restore" ? "Xác nhận hoàn tác bust" : operation === "receipt" ? "Đối chiếu yêu cầu" : "Hủy yêu cầu đang chờ" }));
    const saved = sessionStorage.getItem(sessionStorage.key(0)!);
    await act(async () => { await vi.advanceTimersByTimeAsync(20001); });
    expect(screen.getByRole("button", { name: "Đối chiếu yêu cầu" })).toBeEnabled();
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(saved);
    expect(state.restore).toHaveBeenCalledOnce();
    await act(async () => { complete({ ok: true, data: operation === "restore" ? canonicalReceipt : { ok: true, status: "committed", result: canonicalReceipt } }); });
    expect(view.onRestored).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(saved);
  });
  it.each(["other-actor", "wrong-request", "unknown", "network"])("retains the frozen intent on cancellation %s", async (failure) => {
    state.restore.mockResolvedValue({ ok: false, error: "STALE_STATE" });
    state.cancel.mockImplementation(async (intent) => {
      if (failure === "network") throw new TypeError("Failed to fetch");
      return { ok: true, data: { ok: true, status: failure === "unknown" ? "unknown" : "committed", result: {
        ok: false, status: "cancelled", error: "REQUEST_CANCELLED",
        actor_id: failure === "other-actor" ? "owner-b" : "owner-a",
        request_id: failure === "wrong-request" ? "other-request" : intent.requestId,
        payload: { entry_id: intent.entryId, to_tournament_table_id: intent.toTournamentTableId, to_seat_number: intent.toSeatNumber,
          expected_revision: intent.expectedRevision, expected_control_epoch: intent.expectedControlEpoch, expected_table_session_id: intent.expectedTableSessionId },
      } } };
    });
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    const saved = sessionStorage.getItem(sessionStorage.key(0)!);
    fireEvent.click(screen.getByRole("button", { name: "Hủy yêu cầu đang chờ" }));
    await waitFor(() => expect(state.cancel).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "Hủy yêu cầu đang chờ" })).toBeEnabled());
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(saved);
    expect(screen.getByLabelText("Bàn khôi phục")).toBeDisabled();
    expect(view.onRestored).not.toHaveBeenCalled();
  });
  it("accepts an already committed restore instead of pretending cancellation undid it", async () => {
    state.restore.mockRejectedValueOnce(new Error("commit response lost"));
    state.cancel.mockResolvedValue({ ok: true, data: { ok: true, status: "committed", result: canonicalReceipt } });
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Hủy yêu cầu đang chờ" }));
    await waitFor(() => expect(view.onRestored).toHaveBeenCalledOnce());
    expect(state.restore).toHaveBeenCalledOnce();
    expect(sessionStorage.length).toBe(0);
  });
  it("clears only an exact server cancellation and allows a freshly verified destination", async () => {
    state.restore.mockResolvedValue({ ok: false, error: "STALE_STATE" });
    state.cancel.mockImplementation(async (intent) => ({ ok: true, data: { ok: true, status: "committed", result: {
      ok: false, status: "cancelled", error: "REQUEST_CANCELLED", actor_id: "owner-a", request_id: intent.requestId,
      payload: { entry_id: intent.entryId, to_tournament_table_id: intent.toTournamentTableId, to_seat_number: intent.toSeatNumber,
        expected_revision: intent.expectedRevision, expected_control_epoch: intent.expectedControlEpoch, expected_table_session_id: intent.expectedTableSessionId },
    } } }));
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Hủy yêu cầu đang chờ" }));
    await waitFor(() => expect(screen.getByLabelText("Bàn khôi phục")).toBeEnabled());
    expect(state.cancel).toHaveBeenCalledWith(state.restore.mock.calls[0][0]);
    expect(sessionStorage.length).toBe(0);
    expect(view.onRestored).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
  });
  it("offers server cancellation for a stale rejected restore while retaining its frozen identity", async () => {
    state.restore.mockResolvedValue({ ok: false, error: "STALE_STATE" });
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await waitFor(() => expect(state.restore).toHaveBeenCalledOnce());
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Bàn khôi phục")).toBeDisabled();
    expect(view.onRestored).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Hủy yêu cầu đang chờ" })).toBeEnabled();
  });
  it("verifies the Floor-selected destination before restoring without a second selection", async () => {
    const onRestored = vi.fn();
    render(<RestoreBustDialog actorId="owner-a" tournamentId="tour-a" target={{ ...target, destination: { tableId: "tt-a", seatNumber: 1 } }}
      onRestored={onRestored} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" })).not.toBeDisabled());
    expect(screen.getByLabelText("Ghế khôi phục")).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledOnce());
    expect(state.restore).toHaveBeenCalledWith(expect.objectContaining({ toTournamentTableId: "tt-a", toSeatNumber: 1, expectedRevision: 7 }));
  });
  it("shows evidenced stack, excludes locked seats and submits exact session fences", async () => {
    const view = mount(); await choose();
    expect(screen.queryByRole("option", { name: "Ghế 2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await waitFor(() => expect(view.onRestored).toHaveBeenCalledOnce());
    expect(state.restore).toHaveBeenCalledWith(expect.objectContaining({ entryId: "entry-a", toTournamentTableId: "tt-a",
      toSeatNumber: 1, expectedRevision: 7, expectedControlEpoch: 2, expectedTableSessionId: "session-a", requestId: expect.any(String) }));
  });
  it("replays the identical intent after response loss without duplicate automatic calls", async () => {
    state.restore.mockRejectedValueOnce(new Error("response lost"));
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    expect(state.restore).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Bàn khôi phục")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đã gửi" }));
    await waitFor(() => expect(view.onRestored).toHaveBeenCalledOnce());
    expect(state.restore.mock.calls[1][0]).toEqual(state.restore.mock.calls[0][0]);
  });
  it("does not submit or invent stack when evidence is unavailable", async () => {
    state.entries.mockResolvedValue({ ok: true, data: [] }); mount();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" })).toBeDisabled();
    expect(state.restore).not.toHaveBeenCalled();
  });
  it("preserves the unknown restore identity through genuine unmount and remount", async () => {
    state.restore.mockRejectedValueOnce(new Error("response lost; commit unknown"));
    const first = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    const original = state.restore.mock.calls[0][0];
    first.unmount();
    mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận hoàn tác bust|Kiểm tra lại yêu cầu đã gửi/ }));
    await waitFor(() => expect(state.restore).toHaveBeenCalledTimes(2));
    expect(state.restore.mock.calls[1][0]).toEqual(original);
  });
  it("discards a previous lifetime response after actor A to B to A", async () => {
    let complete!: (value: unknown) => void;
    state.restore.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const first = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await waitFor(() => expect(state.restore).toHaveBeenCalledOnce());
    first.rerender(<RestoreBustDialog actorId="owner-b" tournamentId="tour-a" target={target}
      onRestored={first.onRestored} onClose={first.onClose} />);
    first.rerender(<RestoreBustDialog actorId="owner-a" tournamentId="tour-a" target={target}
      onRestored={first.onRestored} onClose={first.onClose} />);
    complete({ ok: true, data: canonicalReceipt });
    await waitFor(() => expect(screen.queryByText("Đang xác nhận…")).toBeNull());
    expect(first.onRestored).not.toHaveBeenCalled();
    expect(first.onClose).not.toHaveBeenCalled();
  });
  it("does not send restore if storage fails before dispatch", async () => {
    mount(); await choose();
    const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage disabled"); });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
      await screen.findByText(/Không lưu được mã yêu cầu an toàn/);
      expect(state.restore).not.toHaveBeenCalled();
    } finally { failure.mockRestore(); }
  });
  it("does not clear an unknown request for malformed success", async () => {
    state.restore.mockResolvedValueOnce({ ok: true, data: {} });
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByText(/Phản hồi chưa xác minh đúng entry/);
    expect(view.onRestored).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đã gửi" })).not.toBeDisabled();
  });
  it("reconciles an unknown restore by read only without retrying its mutation", async () => {
    state.restore.mockRejectedValueOnce(new Error("response lost"));
    mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu yêu cầu" }));
    await waitFor(() => expect(state.receipt).toHaveBeenCalledOnce());
    expect(state.receipt).toHaveBeenCalledWith(state.restore.mock.calls[0][0]);
    expect(state.restore).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(1);
  });
  it("accepts a matching committed receipt without repeating the restore write", async () => {
    state.restore.mockRejectedValueOnce(new Error("response lost"));
    state.receipt.mockResolvedValueOnce({ ok: true, data: { ok: true, status: "committed", result: canonicalReceipt } });
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu yêu cầu" }));
    await waitFor(() => expect(view.onRestored).toHaveBeenCalledOnce());
    expect(state.restore).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });
  it("blocks corrupted saved requests without replacing their identity", async () => {
    const key = 'vinpoker:restore-bust-pending:["owner-a","tour-a","entry-a"]';
    sessionStorage.setItem(key, '{"intent":null}');
    mount();
    await screen.findByText(/Không xác minh được yêu cầu đã lưu/);
    expect(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" })).toBeDisabled();
    expect(sessionStorage.getItem(key)).toBe('{"intent":null}');
    expect(state.restore).not.toHaveBeenCalled();
  });
  it("keeps the original unknown request after a later authorization rejection", async () => {
    state.restore.mockRejectedValueOnce(new Error("response lost"));
    state.restore.mockResolvedValueOnce({ ok: false, error: "actor_not_allowed" });
    mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đã gửi" }));
    await screen.findByText(/Tài khoản không có quyền/);
    expect(state.restore.mock.calls[1][0]).toEqual(state.restore.mock.calls[0][0]);
    const key = 'vinpoker:restore-bust-pending:["owner-a","tour-a","entry-a"]';
    expect(JSON.parse(sessionStorage.getItem(key)!).intent).toEqual(state.restore.mock.calls[0][0]);
    expect(screen.getByLabelText("Bàn khôi phục")).toBeDisabled();
  });
});

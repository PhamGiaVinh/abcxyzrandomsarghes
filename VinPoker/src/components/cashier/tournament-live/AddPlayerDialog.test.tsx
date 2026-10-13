import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manualPlayerPayload, type ManualPlayerIntent } from "@/lib/floorManualPlayerIntent";
const state = vi.hoisted(() => ({ add: vi.fn(), receipt: vi.fn(), done: vi.fn(), close: vi.fn(), supabase: {} }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => state.supabase }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => ({ addManualPlayer: state.add, getManualPlayerReceipt: state.receipt }) }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: ({ open, receipt }: { open: boolean; receipt: { playerName: string } | null }) => open ? <p>Vé: {receipt?.playerName}</p> : null }));
import { AddPlayerDialog } from "./AddPlayerDialog";
const id = "11111111-1111-4111-8111-111111111111";
const props = { open: true, onOpenChange: state.close, tournamentId: id, tournamentName: "TEST", tournamentDate: null,
  tableTtId: id, maxSeats: 8, occupiedSeats: [], lockedSeats: [2], defaultSeatNumber: 1, onDone: state.done,
  actorId: id, tableSessionId: id, expectedRevision: 4, expectedControlEpoch: 2 };
function proof(i: ManualPlayerIntent) { return { ok: true, actor_id: i.actorId, request_id: i.requestId, payload: manualPlayerPayload(i),
  tournament_table_id: i.tableId, table_session_id: i.sessionId, seat_number: i.seat, control_epoch: i.epoch, revision: i.revision + 1,
  entry_id: id, seat_id: id, receipt_id: id, display_name: i.name, receipt_code: "TEST", starting_stack: 20000, table_number: 21 }; }
function submit() { fireEvent.change(screen.getByLabelText("Tên người chơi"), { target: { value: "TEST One" } }); fireEvent.click(screen.getByRole("button", { name: "Thêm người" })); }
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); state.add.mockResolvedValue({ ok: false, error: "network" }); state.receipt.mockResolvedValue({ ok: true, data: { ok: true, status: "not_found" } }); });
afterEach(cleanup);
describe("manual player dialog", () => {
  it("does not erase typing when a roster refresh changes the props", () => {
    const view = render(<AddPlayerDialog {...props} />);
    fireEvent.change(screen.getByLabelText("Tên người chơi"), { target: { value: "TEST One" } });
    view.rerender(<AddPlayerDialog {...props} occupiedSeats={[3]} expectedRevision={5} />);
    expect(screen.getByLabelText("Tên người chơi")).toHaveValue("TEST One");
    expect(screen.queryByRole("option", { name: "Ghế 2" })).not.toBeInTheDocument();
  });
  it("freezes and recovers the same key and old fences after a lost response and remount", async () => {
    const view = render(<AddPlayerDialog {...props} />); submit(); await screen.findByRole("alert");
    const original = state.add.mock.calls[0][0];
    expect(screen.getByLabelText("Tên người chơi")).toBeDisabled(); view.unmount();
    render(<AddPlayerDialog {...props} expectedRevision={7} expectedControlEpoch={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu yêu cầu" })); await screen.findByRole("alert");
    expect(state.receipt).toHaveBeenCalledWith(original); expect(state.done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại nguyên yêu cầu" }));
    await waitFor(() => expect(state.add).toHaveBeenCalledTimes(2)); expect(state.add.mock.calls[1][0]).toEqual(original);
  });
  it("synchronous double click sends one request", async () => {
    state.add.mockReturnValue(new Promise(() => {})); render(<AddPlayerDialog {...props} />); submit();
    fireEvent.click(screen.getByRole("button", { name: "Đang xác nhận…" })); expect(state.add).toHaveBeenCalledTimes(1);
  });
  it("accepts a resolved receipt and never falls back to current form fields", async () => {
    state.add.mockImplementation(async (i) => ({ ok: true, data: proof(i) })); render(<AddPlayerDialog {...props} />); submit();
    await screen.findByText("Vé: TEST One"); expect(state.done).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).resolved).toBe(true);
  });
  it("malformed success does not show a ticket or clear the journal", async () => {
    state.add.mockImplementation(async (i) => ({ ok: true, data: { ...proof(i), table_session_id: "other" } }));
    render(<AddPlayerDialog {...props} />); submit(); await screen.findByRole("alert");
    expect(state.done).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(1);
  });
  it("allows an exact receipt already settled by a sibling view", async () => {
    state.add.mockImplementation(async (i) => { sessionStorage.clear(); return { ok: true, data: proof(i) }; });
    render(<AddPlayerDialog {...props} />); submit(); await screen.findByText("Vé: TEST One"); expect(state.done).toHaveBeenCalledTimes(1);
  });
  it("clears only an exact durable rejection, permitting a fresh attempt", async () => {
    state.add.mockImplementation(async (i) => ({ ok: true, data: { ...proof(i), ok: false, error: "seat_locked" } }));
    render(<AddPlayerDialog {...props} />); submit(); await screen.findByRole("alert");
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).resolved).toBe(true); expect(screen.getByLabelText("Tên người chơi")).not.toBeDisabled();
    expect(screen.queryByText("Vé: TEST One")).not.toBeInTheDocument();
  });
  it("a late actor A response cannot update B or a new A lifetime", async () => {
    let resolve!: (v: unknown) => void; let sent!: ManualPlayerIntent;
    state.add.mockImplementation((i) => { sent = i; return new Promise((r) => { resolve = r; }); });
    const view = render(<AddPlayerDialog {...props} />); submit();
    view.rerender(<AddPlayerDialog {...props} actorId="22222222-2222-4222-8222-222222222222" />);
    view.rerender(<AddPlayerDialog {...props} />); resolve({ ok: true, data: proof(sent) });
    await waitFor(() => expect(screen.getByRole("button", { name: "Đối chiếu yêu cầu" })).toBeInTheDocument());
    expect(state.done).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(1);
  });
  it("a newer settled request fences an older delayed result", async () => {
    state.add.mockImplementation(async (i) => {
      sessionStorage.setItem(sessionStorage.key(0)!, JSON.stringify({ ...i, requestId: "22222222-2222-4222-8222-222222222222", resolved: true }));
      return { ok: true, data: proof(i) };
    });
    render(<AddPlayerDialog {...props} />); submit(); await screen.findByRole("alert");
    expect(state.done).not.toHaveBeenCalled(); expect(screen.queryByText("Vé: TEST One")).not.toBeInTheDocument();
  });
  it("missing exact session disables a new mutation", () => {
    render(<AddPlayerDialog {...props} tableSessionId={null} />);
    fireEvent.change(screen.getByLabelText("Tên người chơi"), { target: { value: "TEST One" } });
    expect(screen.getByRole("button", { name: "Thêm người" })).toBeDisabled(); expect(state.add).not.toHaveBeenCalled();
  });
});

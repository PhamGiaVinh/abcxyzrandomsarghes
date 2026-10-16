import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const backend = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } }));
const editor = vi.hoisted(() => ({ enabled: false }));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => backend }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { trackerHistoryCompletionWorker: true, trackerHandHistoryEdit: true, trackerResettleForward: true }, isTrackerAtomicResettleAvailable: () => false }));
vi.mock("@/lib/tracker-poker/handPlayerNamesClient", () => ({
  handPlayersHasSnapshotForClient: async () => true,
  fetchHandPlayerDisplayForClient: async () => new Map(),
}));
// This seam supplies a draft; the actual parent orchestration/preview is rendered.
// Real editor/cardpicker and SQL are covered by the separate native journey.
vi.mock("@/components/cashier/tournament-live/HandEditPanel", () => ({
  HandEditPanel: ({ onResettle, onCancel, saving }: { onResettle: (...args: unknown[]) => unknown; onCancel: () => void; saving: boolean }) => editor.enabled
    ? <><button disabled={saving} onClick={() => { void onResettle({}, { community_cards: ["2c", "3d", "4h"] }, "TEST correction", [], []); }}>Preview draft TEST</button>
      <button onClick={onCancel}>Cancel draft TEST</button></> : null,
}));
vi.mock("@/components/cashier/tournament-live/FloorHandActionReview", () => ({ FloorHandActionReview: () => null }));
vi.mock("@/components/cashier/tournament-live/HistoricalSettlementDisplayControl", () => ({ HistoricalSettlementDisplayControl: () => null }));
vi.mock("@/components/cashier/tournament-live/HistoricalSettlementBatchControl", () => ({ HistoricalSettlementBatchControl: () => null }));
vi.mock("@/components/cashier/tournament-live/resettleApply", () => ({
  runClientResettle: () => ({ result: { ok: true, targetWinnerIds: [], changes: [], summary: "modeled preview TEST" }, entryByPlayer: new Map(), entryByHandPlayer: new Map() }),
  buildServerSettlementEdit: () => ({ communityCards: ["2c", "3d", "4h"] }),
  resettleChipChanges: () => [], resettleHandEndStacks: () => ({ rows: [], conserved: true, beforeTotal: 0, afterTotal: 0 }),
  checkExpectedHandEndStacks: () => ({ rows: [], matchesEngine: true, expectedTotal: 0 }),
}));
vi.mock("@/components/cashier/tournament-live/handEditDiff", () => ({}));

import { HandHistoryWorkspace } from "@/components/cashier/tournament-live/HandHistoryWorkspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const ok = (data: unknown[]) => ({ data, error: null });
function query(result: () => Promise<unknown>) {
  const builder = {
    select: () => builder, eq: () => builder, in: () => builder,
    order: () => builder, range: () => builder, gte: () => builder,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => result().then(resolve, reject),
  };
  return builder;
}
function hand(id: string, number: number) {
  return { id, hand_number: number, table_id: null, created_at: "2026-10-16T00:00:00Z", status: "completed", community_cards: [], is_voided: false };
}
beforeEach(() => {
  auth.user = null;
  editor.enabled = false;
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands" ? [hand("hand-a", 1)] : [])));
  // Keep table inventory unresolved so its independent effect does not trigger another load.
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2" ? new Promise(() => {}) : Promise.resolve(ok([])));
});

it.each(["hand", "cancel", "refresh"])("does not restore a canceled preview in the rendered parent after %s change", async (change) => {
  auth.user = { id: "81100000-0000-4000-8000-000000000001" };editor.enabled = true;
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands"
    ? [hand("hand-a", 1), hand("hand-b", 2)] : table === "hand_players"
      ? ["hand-a", "hand-b"].map(id => ({ id: id+"-player", hand_id: id, player_id: "player", entry_number: 1, seat_number: 1, starting_stack: 100, ending_stack: 100 })) : [])));
  const oldPreview = deferred<unknown>();backend.functions.invoke.mockReturnValue(oldPreview.promise);
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("#1"));
  fireEvent.click(screen.getByRole("button", { name: "Xem bản nháp sửa hand" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview draft TEST" }));
  await waitFor(() => expect(backend.functions.invoke).toHaveBeenCalledTimes(1));
  if (change === "hand") fireEvent.click(screen.getByText("#2"));
  else if (change === "refresh") fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
  else fireEvent.click(screen.getByRole("button", { name: "Cancel draft TEST" }));
  fireEvent.click(await screen.findByRole("button", { name: "Xem bản nháp sửa hand" }));
  const ready = { data: { ok: true, status: "preview", draft_status: "READY_TO_APPLY", source_revision: 9,
    source_chain_hash: "a".repeat(64), outcome_hash: "b".repeat(64), request_hash: "c".repeat(64) }, error: null };
  await act(async () => { oldPreview.resolve(ready); });
  expect(screen.queryByText("Xem trước — tính lại chip")).not.toBeInTheDocument();
  backend.functions.invoke.mockResolvedValue(ready);
  fireEvent.click(screen.getByRole("button", { name: "Preview draft TEST" }));
  expect(await screen.findByText("Xem trước — tính lại chip")).toBeInTheDocument();
  expect(backend.functions.invoke.mock.calls[1][1].body.hand_id).toBe(change === "hand" ? "hand-b" : "hand-a");
  expect(backend.functions.invoke.mock.calls.every(([, args]) => args.body.mode === "preview")).toBe(true);
});

it.each(["server", "chain", "detail"])("releases a hung %s preview read with a timeout and ignores its late response", async (phase) => {
  auth.user = { id: "81100000-0000-4000-8000-000000000001" };editor.enabled = true;
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands" ? [hand("hand-a", 1)]
    : table === "hand_players" ? [{ id: "hp-a", hand_id: "hand-a", player_id: "player", entry_number: 1, seat_number: 1, starting_stack: 100, ending_stack: 100 }] : [])));
  const latePreview = deferred<unknown>();backend.functions.invoke.mockReturnValue(latePreview.promise);
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("#1"));
  fireEvent.click(screen.getByRole("button", { name: "Xem bản nháp sửa hand" }));
  if (phase === "chain") backend.from.mockImplementation(() => query(() => latePreview.promise));
  if (phase === "detail") backend.from.mockImplementation((table: string) => query(() => table === "hand_players" ? latePreview.promise
    : Promise.resolve(ok(table === "tournament_hands" ? [hand("hand-a", 1)] : []))));
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview draft TEST" })); });
  expect(backend.functions.invoke).toHaveBeenCalledTimes(phase === "server" ? 1 : 0);
  expect(screen.getByRole("button", { name: "Preview draft TEST" })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(notices.error).toHaveBeenCalledWith("Hết thời gian xem trước. Chưa gửi thay đổi; hãy thử lại khi kết nối ổn định.");
  expect(screen.getByRole("button", { name: "Preview draft TEST" })).toBeEnabled();
  await act(async () => { latePreview.resolve({ data: { ok: true, status: "preview", draft_status: "READY_TO_APPLY", source_revision: 9,
    source_chain_hash: "a".repeat(64), outcome_hash: "b".repeat(64), request_hash: "c".repeat(64) }, error: null }); });
  expect(screen.queryByText("Xem trước — tính lại chip")).not.toBeInTheDocument();
  expect(backend.functions.invoke).toHaveBeenCalledTimes(phase === "server" ? 1 : 0);
});

it.each(["actor-b", null])("invalidates hand/table reads on the same client and tournament after account becomes %s", async (nextActor) => {
  auth.user = { id: "actor-a" };
  const oldQueue = deferred<ReturnType<typeof ok>>();
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2"
    ? Promise.resolve({ data: { ok: true, tables: [{ tournament_table_id: "table-a", table_name: "Actor A table" }] }, error: null })
    : oldQueue.promise);
  const view = render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  await screen.findByText("#1");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeEnabled());
  const nextRead = deferred<ReturnType<typeof ok>>(), nextTables = deferred<unknown>();
  backend.from.mockImplementation(() => query(() => nextRead.promise));
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2" ? nextTables.promise : Promise.resolve(ok([])));
  auth.user = nextActor ? { id: nextActor } : null;
  view.rerender(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Actor A table" })).not.toBeInTheDocument();
  await act(async () => { oldQueue.resolve(ok([])); });
  expect(screen.getByRole("button", { name: "Đang tải" })).toBeDisabled();
  await act(async () => {
    nextRead.resolve(ok([]));
    nextTables.resolve({ data: { ok: false, error: "actor_not_allowed" }, error: null });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("actor_not_allowed");
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("shows a retryable read error and ends loading when a hand query rejects", async () => {
  backend.from.mockImplementation(() => query(async () => { throw new Error("network unavailable"); }));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText(/Không tải được lịch sử hand: network unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
  expect(screen.queryByText("Chưa có hand nào được ghi")).not.toBeInTheDocument();
});

it("keeps hand data but marks queue status unavailable when the queue read rejects", async () => {
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2"
    ? new Promise(() => {}) : Promise.reject(new Error("queue unavailable")));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText("Không tải được trạng thái hàng đợi xác minh.")).toBeInTheDocument();
  expect(screen.getByText("#1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Làm mới" })).toBeEnabled();
});

it.each([null, {}, [null], [{ hand_id: "hand-a", queue_status: "unknown-status" }], [{ queue_status: "pending" }],
  [{ hand_id: "hand-a", queue_status: "pending" }, { hand_id: "hand-a", queue_status: "stale" }]])(
  "marks malformed queue payload unavailable rather than silently empty: %j", async (payload) => {
    backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2"
      ? new Promise(() => {}) : Promise.resolve({ data: payload, error: null }));
    render(<HandHistoryWorkspace tournamentId="tour-a" />);
    expect(await screen.findByText("Không tải được trạng thái hàng đợi xác minh.")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.queryByText("Đang xác minh", { selector: "span" })).not.toBeInTheDocument();
  });

it("keeps a successful empty queue distinct from an unavailable queue", async () => {
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  await screen.findByText("#1");
  await waitFor(() => expect(screen.getByRole("button", { name: "Làm mới" })).toBeEnabled());
  expect(screen.queryByText("Không tải được trạng thái hàng đợi xác minh.")).not.toBeInTheDocument();
});

it("renders a valid pending queue row without calling it unavailable", async () => {
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2" ? new Promise(() => {})
    : Promise.resolve(ok([{ hand_id: "hand-a", queue_status: "pending" }])));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText("Đang xác minh", { selector: "span" })).toBeInTheDocument();
  expect(screen.queryByText("Không tải được trạng thái hàng đợi xác minh.")).not.toBeInTheDocument();
});

it("does not display partial queue data returned alongside an RPC error", async () => {
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2" ? new Promise(() => {})
    : Promise.resolve({ data: [{ hand_id: "hand-a", queue_status: "pending" }], error: { message: "503 unavailable" } }));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText("Không tải được trạng thái hàng đợi xác minh.")).toBeInTheDocument();
  expect(screen.getByText("#1")).toBeInTheDocument();
  expect(screen.queryByText("Đang xác minh", { selector: "span" })).not.toBeInTheDocument();
});

it("does not let an old queue response clear the new tournament hand selection", async () => {
  const oldQueue = deferred<ReturnType<typeof ok>>();
  backend.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => name === "list_tracker_tables_v2"
    ? new Promise(() => {}) : args.p_tournament_id === "tour-a" ? oldQueue.promise : Promise.resolve(ok([])));
  const view = render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" workspaceMode initialHandId="hand-a" /></MemoryRouter>);
  await screen.findByText("#1");
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands" ? [hand("hand-b", 2)] : [])));
  view.rerender(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-b" workspaceMode initialHandId="hand-b" /></MemoryRouter>);
  await screen.findByText("#2");
  expect(screen.getByRole("button", { name: "Chọn hand khác" })).toBeInTheDocument();
  await act(async () => { oldQueue.resolve(ok([])); });
  expect(screen.getByRole("button", { name: "Chọn hand khác" })).toBeInTheDocument();
});

it("removes the previous tournament archive while the next scope is still loading", async () => {
  const nextRead = deferred<ReturnType<typeof ok>>();
  const view = render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  await screen.findByText("#1");
  backend.from.mockImplementation((table: string) => query(() => table === "tournament_hands" ? nextRead.promise : Promise.resolve(ok([]))));
  view.rerender(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-b" /></MemoryRouter>);
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Đang tải" })).toBeDisabled();
  await act(async () => { nextRead.resolve(ok([hand("hand-b", 2)])); });
  expect(await screen.findByText("#2")).toBeInTheDocument();
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
});

it("removes the previous table archive while a new table read is pending", async () => {
  backend.rpc.mockImplementation((name: string) => Promise.resolve(name === "list_tracker_tables_v2"
    ? { data: { ok: true, tables: [{ tournament_table_id: "table-a", table_name: "Table A" }, { tournament_table_id: "table-b", table_name: "Table B" }] }, error: null }
    : ok([])));
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" initialTableId="table-a" /></MemoryRouter>);
  await screen.findByText("#1");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeEnabled());
  const nextRead = deferred<ReturnType<typeof ok>>();
  backend.from.mockImplementation((table: string) => query(() => table === "tournament_hands" ? nextRead.promise : Promise.resolve(ok([]))));
  fireEvent.change(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" }), { target: { value: "table-b" } });
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
  await act(async () => { nextRead.resolve(ok([hand("hand-b", 2)])); });
  expect(await screen.findByText("#2")).toBeInTheDocument();
});

it("shows table authority errors and lets an explicit retry recover the filter", async () => {
  backend.rpc.mockImplementation((name: string) => Promise.resolve(name === "list_tracker_tables_v2"
    ? { data: { ok: false, error: "actor_not_allowed" }, error: null } : ok([])));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được danh sách bàn: actor_not_allowed");
  expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeDisabled();
  expect(backend.rpc.mock.calls.some(([name]) => name === "get_tournament_tables")).toBe(false);
  backend.rpc.mockImplementation((name: string) => Promise.resolve(name === "list_tracker_tables_v2"
    ? { data: { ok: true, tables: [{ tournament_table_id: "table-a", table_name: "Table A" }] }, error: null } : ok([])));
  fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách bàn" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeEnabled());
  expect(screen.getByRole("option", { name: "Table A" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("ends a never-settling hand read and ignores its late completion", async () => {
  vi.useFakeTimers();
  const read = deferred<ReturnType<typeof ok>>();
  backend.rpc.mockResolvedValue({ data: { ok: true, tables: [] }, error: null });
  backend.from.mockImplementation(() => query(() => read.promise));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByText(/Hết thời gian tải lịch sử hand/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
  await act(async () => { read.resolve(ok([hand("late", 999)])); });
  expect(screen.queryByText("#999")).not.toBeInTheDocument();
  expect(screen.getByText(/Hết thời gian tải lịch sử hand/)).toBeInTheDocument();
});

it("ends a never-settling table read and ignores its late inventory", async () => {
  vi.useFakeTimers();
  const read = deferred<unknown>();
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2" ? read.promise : Promise.resolve(ok([])));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("Hết thời gian tải danh sách bàn");
  expect(screen.getByRole("button", { name: "Tải lại danh sách bàn" })).toBeEnabled();
  await act(async () => { read.resolve({ data: { ok: true, tables: [{ tournament_table_id: "late", table_name: "Late table" }] }, error: null }); });
  expect(screen.queryByRole("option", { name: "Late table" })).not.toBeInTheDocument();
});

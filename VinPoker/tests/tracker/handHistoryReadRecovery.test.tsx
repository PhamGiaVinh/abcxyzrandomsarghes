import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const backend = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => backend }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { trackerHistoryCompletionWorker: true }, isTrackerAtomicResettleAvailable: () => false }));
vi.mock("@/lib/tracker-poker/handPlayerNamesClient", () => ({
  handPlayersHasSnapshotForClient: async () => true,
  fetchHandPlayerDisplayForClient: async () => new Map(),
}));
vi.mock("@/components/cashier/tournament-live/HandEditPanel", () => ({ HandEditPanel: () => null }));
vi.mock("@/components/cashier/tournament-live/FloorHandActionReview", () => ({ FloorHandActionReview: () => null }));
vi.mock("@/components/cashier/tournament-live/HistoricalSettlementDisplayControl", () => ({ HistoricalSettlementDisplayControl: () => null }));
vi.mock("@/components/cashier/tournament-live/HistoricalSettlementBatchControl", () => ({ HistoricalSettlementBatchControl: () => null }));
vi.mock("@/components/cashier/tournament-live/resettleApply", () => ({}));
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
    order: () => builder, range: () => builder,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => result().then(resolve, reject),
  };
  return builder;
}
function hand(id: string, number: number) {
  return { id, hand_number: number, table_id: null, created_at: "2026-10-16T00:00:00Z", status: "completed", community_cards: [], is_voided: false };
}
beforeEach(() => {
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands" ? [hand("hand-a", 1)] : [])));
  // Keep table inventory unresolved so its independent effect does not trigger another load.
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_tables_v2" ? new Promise(() => {}) : Promise.resolve(ok([])));
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

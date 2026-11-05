import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tournament } from "@/types/tournament";
const state = vi.hoisted(() => ({ roster: vi.fn(), entries: vi.fn(), restorable: vi.fn(), moves: vi.fn(), redraw: vi.fn() }));
type LiveChannel = { changes: { table: string; filter: string; read: () => void }[]; status?: (value: string) => void; ready?: (value: { extension: string; status: string }) => void;
  on: (kind: string, filter: { table: string; filter: string }, read: () => void) => LiveChannel;
  subscribe: (status: (value: string) => void) => LiveChannel };
const live = vi.hoisted(() => ({ channels: [] as LiveChannel[] }));
const client = { rpc: vi.fn(), removeChannel: vi.fn(async () => "ok"), channel: vi.fn(() => {
  const channel: LiveChannel = { changes: [],
    on(kind, filter, read) { if (kind === "system") channel.ready = read as unknown as LiveChannel["ready"]; else channel.changes.push({ ...filter, read }); return channel; },
    subscribe(status) { channel.status = status; return channel; } };
  live.channels.push(channel); return channel;
}) };
const v3 = { enabled: true, redrawSeatLockEnabled: true, getTournamentTableRoster: state.roster,
  getSeatableEntries: state.entries, getRestorableEntries: state.restorable, getPendingTrackerMoves: state.moves };
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => client }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => v3 }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorRedrawSeatLockV1: true, floorTableControlV3: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "floor" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("../OpenTableDialog", () => ({ OpenTableDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Open fixture</div> : null }));
vi.mock("../FloorRedrawWorkspaceV1", () => ({ FloorRedrawWorkspaceV1: (props: unknown) => { state.redraw(props); return null; } }));
vi.mock("../RestoreBustDialog", () => ({ RestoreBustDialog: () => null }));
vi.mock("../AddPlayerDialog", () => ({ AddPlayerDialog: () => null }));
vi.mock("../MovePlayerDialog", () => ({ MovePlayerDialog: () => null }));
import { FloorTableMapPanelV3 } from "../FloorTableMapPanelV3";
import { FloorTableMapPanel } from "../FloorTableMapPanel";
const tour = (status: string) => ({ id: "tour", name: "TEST", status } as Tournament);
beforeEach(() => { for (const method of Object.values(state)) method.mockReset().mockResolvedValue({ ok: true, data: [] });
  live.channels.length = 0; client.channel.mockClear(); client.removeChannel.mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("passes the shell identity to redraw and retires an open dialog when the session changes", async () => {
  const view = render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" sessionEpoch={1} refreshTrigger={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Mở bàn" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(state.redraw).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: "floor", sessionEpoch: 1 }));
  view.rerender(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" sessionEpoch={2} refreshTrigger={0} />);
  await screen.findByRole("button", { name: "Mở bàn" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(state.redraw).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: "floor", sessionEpoch: 2 }));
});
it("does not supply a redraw actor without a ready shell session", async () => {
  render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />);
  await screen.findByRole("button", { name: "Mở bàn" });
  expect(state.redraw).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: undefined, sessionEpoch: undefined }));
});
it.each(["completed", "finished", "cancelled"])("keeps %s read-only with the V3 operation flag off", async status => {
  render(<FloorTableMapPanel tournament={tour(status)} refreshTrigger={0} />);
  await screen.findByText("Không còn phiên bàn đang hoạt động.");
  expect(screen.queryByRole("button", { name: "Mở bàn" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Redraw" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Chọn “Mở bàn”/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
  await screen.findByText("Không còn phiên bàn đang hoạt động.");expect(state.roster).toHaveBeenCalledTimes(2);
});
it("preserves the live open dialog and removes it when the same tournament closes", async () => {
  const view = render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />);
  const open = await screen.findByRole("button", { name: "Mở bàn" });fireEvent.click(open);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<FloorTableMapPanelV3 tournament={tour("completed")} actorId="floor" refreshTrigger={0} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(screen.queryByRole("button", { name: "Mở bàn" })).not.toBeInTheDocument();
  await screen.findByText("Không còn phiên bàn đang hoạt động.");
  view.rerender(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />);
  await screen.findByText(/Chưa có bàn đang hoạt động/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("shows a failed roster read as error rather than verified zero active sessions", async () => {
  state.roster.mockResolvedValue({ ok: false, error: "STALE_STATE" });
  render(<FloorTableMapPanelV3 tournament={tour("completed")} actorId="floor" refreshTrigger={0} />);
  await screen.findByRole("alert");expect(screen.queryByText("Không còn phiên bàn đang hoạt động.")).not.toBeInTheDocument();
});
it("keeps unexpected active sessions visible for inspection without write controls", async () => {
  state.roster.mockResolvedValue({ ok: true, data: [{ tournamentTableId: "table", tableNumber: 3, tableName: "TEST table", seats: [], seatLocks: [], maxSeats: 9 }] });
  render(<FloorTableMapPanelV3 tournament={tour("completed")} actorId="floor" refreshTrigger={0} />);
  await screen.findByRole("alert");expect(screen.getByText(/Bàn 3 · TEST table/)).toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

const table = (number: number) => ({ tournamentTableId: `table-${number}`, gameTableId: `asset-${number}`,
  tableNumber: number, tableName: `TEST table ${number}`, tableSessionId: `session-${number}`, sessionRevision: 1,
  controlEpoch: 1, controlMode: "manual", tournamentTableStatus: "active", sessionClosedAt: null,
  activeDealerAssignmentId: null, seats: [], seatLocks: [], maxSeats: 9 });
it("observes the scoped source tables and coalesces changes into a fresh roster", async () => {
  render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" sessionEpoch={1} refreshTrigger={0} />);
  await screen.findByText(/Chưa có bàn đang hoạt động/);
  expect(live.channels).toHaveLength(1);
  const channel = live.channels[0];
  expect(channel.changes.map(change => change.table)).toEqual(["table_sessions", "tournament_tables", "tournament_seats", "tournament_chip_counts", "tournament_entries"]);
  expect(channel.changes.every(change => change.filter === "tournament_id=eq.tour")).toBe(true);
  state.roster.mockResolvedValue({ ok: true, data: [table(2)] });
  act(() => { channel.changes[0].read(); channel.changes[1].read(); channel.changes[2].read(); });
  expect(screen.getByText("Đang tải danh sách bàn…")).toBeInTheDocument();
  expect(state.roster).toHaveBeenCalledTimes(1);
  await screen.findByRole("button", { name: /Bàn 2, 0\/9 ghế/ });
  expect(state.roster).toHaveBeenCalledTimes(2);
});
it("publishes same-scope snapshots while keeping newer hints fenced", async () => {
  render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />);
  await screen.findByText(/Chưa có bàn đang hoạt động/);
  let finish!: (value: unknown) => void;
  state.roster.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const change = live.channels[0].changes[0].read;
  act(change); await waitFor(() => expect(state.roster).toHaveBeenCalledTimes(2));
  state.roster.mockResolvedValue({ ok: true, data: [table(3)] });
  await act(async () => { change(); finish({ ok: true, data: [table(2)] }); });
  expect(screen.getByRole("button", { name: /Bàn 2, 0\/9 ghế/ })).toBeInTheDocument();
  expect(screen.getByTestId("floor-table-map-v3")).toHaveAttribute("aria-busy", "true");
  await screen.findByRole("button", { name: /Bàn 3, 0\/9 ghế/ });
  expect(state.roster).toHaveBeenCalledTimes(3);
});
it("retires old actor/session callbacks and removes the old channel", async () => {
  const view = render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" sessionEpoch={1} refreshTrigger={0} />);
  await screen.findByText(/Chưa có bàn đang hoạt động/);const old = live.channels[0];
  view.rerender(<FloorTableMapPanelV3 tournament={{ ...tour("live"), id: "other-tour" }} actorId="other-floor" sessionEpoch={2} refreshTrigger={0} />);
  await waitFor(() => expect(state.roster).toHaveBeenLastCalledWith("other-tour"));
  const calls = state.roster.mock.calls.length;
  act(() => { old.changes[0].read(); old.status?.("SUBSCRIBED"); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve,250)); });
  expect(state.roster).toHaveBeenCalledTimes(calls);expect(client.removeChannel).toHaveBeenCalledWith(old);
});
it("does not request hidden-tab changes until the tab becomes visible", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />);
  await screen.findByText(/Chưa có bàn đang hoạt động/);
  visibility.mockReturnValue("hidden");
  act(() => { live.channels[0].changes[0].read(); document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve,250)); });
  expect(state.roster).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");state.roster.mockResolvedValue({ ok: true, data: [table(4)] });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await screen.findByRole("button", { name: /Bàn 4, 0\/9 ghế/ });
});
it("reconciles missing source changes even when a partial channel reports healthy", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />); });
  expect(state.roster).toHaveBeenCalledTimes(1);
  await act(async () => { live.channels[0].status?.("SUBSCRIBED"); live.channels[0].ready?.({ extension: "postgres_changes", status: "ok" }); await vi.advanceTimersByTimeAsync(200); });
  expect(state.roster).toHaveBeenCalledTimes(2);
  // No CDC hint arrives for the new table: another published source's system
  // acknowledgement must not suppress authorized snapshot reconciliation.
  state.roster.mockResolvedValue({ ok: true, data: [table(7)] });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_799); });expect(state.roster).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });expect(state.roster).toHaveBeenCalledTimes(3);
  expect(screen.getByText("TEST table 7", {exact:false})).toBeInTheDocument();
});
it("does not poll a hidden staff screen while source coverage is incomplete", async () => {
  vi.useFakeTimers();const visibility=vi.spyOn(document,"visibilityState","get");
  await act(async()=>{render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0}/>);});
  visibility.mockReturnValue("hidden");
  await act(async()=>{live.channels[0].ready?.({extension:"postgres_changes",status:"ok"});await vi.advanceTimersByTimeAsync(10_000);});
  expect(state.roster).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");state.roster.mockResolvedValue({ok:true,data:[table(8)]});
  await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));await vi.advanceTimersByTimeAsync(200);});
  expect(screen.getByText("TEST table 8",{exact:false})).toBeInTheDocument();
});
it("keeps the last roster visible while retiring its action context", async () => {
  state.roster.mockResolvedValue({ ok: true, data: [table(2)] });
  render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />);
  await screen.findByRole("button", { name: /Bàn 2, 0\/9 ghế/ });
  act(() => { live.channels[0].changes[0].read(); });
  expect(screen.getByRole("button", { name: /Bàn 2, 0\/9 ghế/ })).toBeInTheDocument();
  expect(screen.getByTestId("floor-table-map-v3")).toHaveAttribute("aria-busy", "true");
  await waitFor(() => expect(screen.getByTestId("floor-table-map-v3")).toHaveAttribute("aria-busy", "false"));
});

it("advances snapshots under sustained hints while keeping writes fenced", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />); });
  let number = 1;
  state.roster.mockImplementation(() => new Promise(resolve => {
    const snapshot = table(++number);
    setTimeout(() => resolve({ ok: true, data: [snapshot] }), 300);
  }));
  const hints = setInterval(live.channels[0].changes[0].read, 50);
  await act(async () => { await vi.advanceTimersByTimeAsync(550); });
  expect(screen.getByText("TEST table 2", { exact: false })).toBeInTheDocument();
  expect(screen.getByTestId("floor-table-map-v3")).toHaveAttribute("aria-busy", "true");
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByText("TEST table 3", { exact: false })).toBeInTheDocument();
  expect(screen.getByTestId("floor-table-map-v3")).toHaveAttribute("aria-busy", "true");
  clearInterval(hints);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByTestId("floor-table-map-v3")).toHaveAttribute("aria-busy", "false");
});

it("verifies again when PostgreSQL becomes ready after channel join", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<FloorTableMapPanelV3 tournament={tour("live")} actorId="floor" refreshTrigger={0} />); });
  await act(async () => { live.channels[0].status?.("SUBSCRIBED"); await vi.advanceTimersByTimeAsync(200); });
  expect(state.roster).toHaveBeenCalledTimes(2);
  state.roster.mockResolvedValue({ ok: true, data: [table(5)] });
  await act(async () => { live.channels[0].ready?.({ extension: "postgres_changes", status: "ok" }); await vi.advanceTimersByTimeAsync(200); });
  expect(state.roster).toHaveBeenCalledTimes(3);
  expect(screen.getByText("TEST table 5", { exact: false })).toBeInTheDocument();
});

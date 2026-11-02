import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tournament } from "@/types/tournament";
const state = vi.hoisted(() => ({ roster: vi.fn(), entries: vi.fn(), restorable: vi.fn(), moves: vi.fn(), redraw: vi.fn() }));
const client = { rpc: vi.fn() };
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
beforeEach(() => { for (const method of Object.values(state)) method.mockReset().mockResolvedValue({ ok: true, data: [] }); });
afterEach(cleanup);
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

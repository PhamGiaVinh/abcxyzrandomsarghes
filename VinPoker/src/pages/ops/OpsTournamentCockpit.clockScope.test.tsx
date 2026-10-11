import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ id: "a", actor: "owner", authLoading: false, rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: state.id }), useNavigate: () => vi.fn() }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: state.actor ? { id: state.actor } : null, loading: state.authLoading }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => client }));
const client = { rpc: state.rpc, functions: { invoke: state.invoke }, from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
vi.mock("@/ops/workspace/TournamentOpsProvider", () => ({ useTournamentOps: () => ({ snapshot: { clubId: "club" } }) }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { cockpitFloorActions: false } }));
vi.mock("@/components/ops/shared/useFloorSeats", () => ({ useFloorSeats: () => ({ tables: [], seatsByTable: {} }) }));
vi.mock("@/components/ops/shared/FloorPlayerActions", () => ({ FloorPlayerActions: () => null }));
vi.mock("@/components/floor/MultiDayFloorEventPanel", () => ({ MultiDayFloorEventPanel: () => null }));
vi.mock("@/components/cashier/tournament-live/TvBrandingEditor", () => ({ TvBrandingEditor: () => null }));
vi.mock("@/hooks/useTournamentTvDataCore", () => ({ useTournamentTvDataCore: () => ({ state: "ready", refetch: vi.fn(), data: {
  tournamentName: state.id, status: "live", isRunning: false, remainingSeconds: 600,
  playersRemaining: 8, totalEntries: 8, averageStack: 1000, prizePool: 0,
} }) }));
import OpsTournamentCockpit from "./OpsTournamentCockpit";
const clock = (id: string) => ({ tournament_id: id, status: "live", is_running: false,
  remaining_seconds: 600, current_level: { level_number: 2 }, next_level: { level_number: 3 }, control_revision: `revision-${id}` });
beforeEach(() => { state.id = "a"; state.actor = "owner"; state.authLoading = false; state.rpc.mockReset(); state.invoke.mockReset(); });
afterEach(cleanup);
it("removes controls during auth verification and reloads the verified revision", async () => {
  state.rpc.mockResolvedValueOnce({ data: clock("a"), error: null })
    .mockResolvedValue({ data: { ...clock("a"), control_revision: "reverified" }, error: null });
  state.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  await screen.findByRole("button", { name: "Tiếp tục" });
  state.authLoading = true;
  rerender(<OpsTournamentCockpit section="clock" />);
  expect(screen.queryByRole("button", { name: "Tiếp tục" })).not.toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledTimes(1);
  state.authLoading = false;
  rerender(<OpsTournamentCockpit section="clock" />);
  const button = await screen.findByRole("button", { name: "Tiếp tục" });
  await act(async () => fireEvent.click(button));
  expect(state.invoke.mock.calls[0][1].body.expected_control_revision).toBe("reverified");
});

it("does not reuse a pending clock read after leaving and returning to the tab", async () => {
  let old!: (value: unknown) => void;
  state.rpc.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockResolvedValue({ data: { ...clock("a"), control_revision: "returned" }, error: null });
  state.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  rerender(<OpsTournamentCockpit section="screens" />);
  expect(screen.queryByRole("button", { name: "Tiếp tục" })).not.toBeInTheDocument();
  rerender(<OpsTournamentCockpit section="clock" />);
  const button = await screen.findByRole("button", { name: "Tiếp tục" });
  await act(async () => old({ data: clock("a"), error: null }));
  await act(async () => fireEvent.click(button));
  expect(state.invoke.mock.calls[0][1].body.expected_control_revision).toBe("returned");
});
it("rejects a payload belonging to another tournament", async () => {
  state.rpc.mockResolvedValue({ data: clock("foreign"), error: null });
  render(<OpsTournamentCockpit section="clock" />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Tiếp tục" })).not.toBeInTheDocument();
  expect(state.invoke).not.toHaveBeenCalled();
});

it("ignores an old actor response after the new actor loads", async () => {
  let old!: (value: unknown) => void;
  state.rpc.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockResolvedValue({ data: { ...clock("a"), control_revision: "new-actor" }, error: null });
  state.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  state.actor = "other";
  rerender(<OpsTournamentCockpit section="clock" />);
  await screen.findByRole("button", { name: "Tiếp tục" });
  await act(async () => old({ data: clock("a"), error: null }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" })));
  expect(state.invoke.mock.calls[0][1].body.expected_control_revision).toBe("new-actor");
});

it("does not consume an A mutation completion after A B A", async () => {
  state.rpc.mockImplementation((_name, args) => Promise.resolve({ data: clock(args.p_tournament_id), error: null }));
  let finish!: (value: unknown) => void;
  state.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
  state.id = "b"; rerender(<OpsTournamentCockpit section="clock" />);
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  state.id = "a"; rerender(<OpsTournamentCockpit section="clock" />);
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(3));
  await act(async () => finish({ data: { ok: true }, error: null }));
  expect(state.rpc).toHaveBeenCalledTimes(3);
});

it("never sends B's action with a late A clock revision", async () => {
  let old!: (value: unknown) => void;
  state.rpc.mockImplementation((_name, args) => args.p_tournament_id === "a"
    ? new Promise(resolve => { old = resolve; }) : Promise.resolve({ data: clock("b"), error: null }));
  state.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  state.id = "b";
  rerender(<OpsTournamentCockpit section="clock" />);
  await screen.findByRole("button", { name: "Tiếp tục" });
  await act(async () => old({ data: clock("a"), error: null }));
  fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
  await waitFor(() => expect(state.invoke).toHaveBeenCalledTimes(1));
  expect(state.invoke.mock.calls[0][1].body).toEqual({ tournament_id: "b", action: "resume", expected_control_revision: "revision-b" });
});

it("removes old actor controls immediately on logout without anonymous clock reads", async () => {
  state.rpc.mockResolvedValue({ data: clock("a"), error: null });
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  await screen.findByRole("button", { name: "Tiếp tục" });
  const reads = state.rpc.mock.calls.length;
  state.actor = "";
  rerender(<OpsTournamentCockpit section="clock" />);
  expect(screen.queryByRole("button", { name: "Tiếp tục" })).not.toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledTimes(reads);
  expect(state.invoke).not.toHaveBeenCalled();
});

it("removes prior controls when the next tournament read fails", async () => {
  state.rpc.mockResolvedValueOnce({ data: clock("a"), error: null })
    .mockResolvedValue({ data: null, error: { message: "503" } });
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  await screen.findByRole("button", { name: "Tiếp tục" });
  state.id = "b";
  rerender(<OpsTournamentCockpit section="clock" />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Tiếp tục" })).not.toBeInTheDocument();
  expect(state.invoke).not.toHaveBeenCalled();
});

it("guards duplicate clicks and allows B while A remains pending", async () => {
  state.rpc.mockImplementation((_name, args) => Promise.resolve({ data: clock(args.p_tournament_id), error: null }));
  const finish: Array<(value: unknown) => void> = [];
  state.invoke.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  const { rerender } = render(<OpsTournamentCockpit section="clock" />);
  const a = await screen.findByRole("button", { name: "Tiếp tục" });
  fireEvent.click(a); fireEvent.click(a);
  expect(state.invoke).toHaveBeenCalledTimes(1);
  state.id = "b";
  rerender(<OpsTournamentCockpit section="clock" />);
  const b = await screen.findByRole("button", { name: "Tiếp tục" });
  fireEvent.click(b);
  expect(state.invoke).toHaveBeenCalledTimes(2);
  await act(async () => finish[0]({ data: { ok: true }, error: null }));
  expect(b).toBeDisabled();
  cleanup();
  await act(async () => finish[1]({ data: { ok: true }, error: null }));
});

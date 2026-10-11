import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), error: vi.fn(), actor: "owner" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: db.actor ? { id: db.actor } : null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc, functions: { invoke: db.invoke } } }));
vi.mock("react-i18next", () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
vi.mock("sonner", () => ({ toast: { error: db.error, success: vi.fn() } }));
import { ClockPanel } from "./ClockPanel";

const payload = (id: string, level: number) => ({ tournament_id: id, status: "live", is_running: false,
  elapsed_seconds: 0, remaining_seconds: 600, control_revision: `revision-${id}-${level}`,
  current_level: { id: `level-${level}`, level_number: level, small_blind: 100, big_blind: 200,
    ante: 0, duration_minutes: 10, is_break: false }, next_level: null, is_break: false });
beforeEach(() => { db.rpc.mockReset(); db.invoke.mockReset(); db.error.mockReset(); db.actor = "owner"; });
afterEach(cleanup);

it("does not let a late prior-tournament clock replace the current tournament", async () => {
  let resolveA!: (value: unknown) => void;
  db.rpc.mockImplementation((_name, args) => args.p_tournament_id === "a"
    ? new Promise(resolve => { resolveA = resolve; })
    : Promise.resolve({ data: payload("b", 7), error: null }));
  const { rerender } = render(<ClockPanel tournamentId="a" />);
  await waitFor(() => expect(db.rpc).toHaveBeenCalled());
  rerender(<ClockPanel tournamentId="b" />);
  await waitFor(() => expect(screen.getByText(/tournamentLive.clock.level 7/)).toBeInTheDocument());
  await act(async () => resolveA({ data: payload("a", 2), error: null }));
  expect(screen.getByText(/tournamentLive.clock.level 7/)).toBeInTheDocument();
  expect(screen.queryByText(/tournamentLive.clock.level 2/)).not.toBeInTheDocument();
  expect(db.invoke).not.toHaveBeenCalled();
});

it("clears the prior actor context immediately and ignores its late response", async () => {
  let old!: (value: unknown) => void;
  db.rpc.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockResolvedValue({ data: payload("a", 7), error: null });
  const { rerender } = render(<ClockPanel tournamentId="a" />);
  await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(1));
  db.actor = "other";
  rerender(<ClockPanel tournamentId="a" />);
  expect(screen.queryByRole("button", { name: "tournamentLive.clock.resume" })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/tournamentLive.clock.level 7/)).toBeInTheDocument());
  await act(async () => old({ data: payload("a", 2), error: null }));
  expect(screen.queryByText(/tournamentLive.clock.level 2/)).not.toBeInTheDocument();
});

it("only accepts the newest same-scope refresh", async () => {
  let old!: (value: unknown) => void;
  db.rpc.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockResolvedValue({ data: payload("a", 7), error: null });
  const { rerender } = render(<ClockPanel tournamentId="a" refreshTrigger={0} />);
  await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(1));
  rerender(<ClockPanel tournamentId="a" refreshTrigger={1} />);
  await waitFor(() => expect(screen.getByText(/tournamentLive.clock.level 7/)).toBeInTheDocument());
  await act(async () => old({ data: payload("a", 2), error: null }));
  expect(screen.queryByText(/tournamentLive.clock.level 2/)).not.toBeInTheDocument();
});

it("invalidates controls on refresh failure instead of keeping stale write authority", async () => {
  db.rpc.mockResolvedValueOnce({ data: payload("a", 7), error: null })
    .mockResolvedValue({ data: null, error: { message: "503" } });
  render(<ClockPanel tournamentId="a" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "tournamentLive.clock.resume" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "tournamentLive.clock.refresh" }));
  await waitFor(() => expect(db.error).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "tournamentLive.clock.resume" })).not.toBeInTheDocument();
  expect(db.invoke).not.toHaveBeenCalled();
});

it("rejects a successful response for the wrong tournament", async () => {
  db.rpc.mockResolvedValue({ data: payload("foreign", 7), error: null });
  render(<ClockPanel tournamentId="a" />);
  await waitFor(() => expect(db.error).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "tournamentLive.clock.resume" })).not.toBeInTheDocument();
  expect(db.invoke).not.toHaveBeenCalled();
});

it("submits one revision-bound mutation for rapid duplicate clicks", async () => {
  db.rpc.mockResolvedValue({ data: payload("a", 7), error: null });
  let finish!: (value: unknown) => void;
  db.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<ClockPanel tournamentId="a" />);
  const button = await screen.findByRole("button", { name: "tournamentLive.clock.resume" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(db.invoke).toHaveBeenCalledTimes(1);
  expect(db.invoke).toHaveBeenCalledWith("tournament-live-clock", {
    body: { tournament_id: "a", action: "resume", expected_control_revision: "revision-a-7" },
  });
  await act(async () => finish({ data: { ok: true }, error: null }));
});

it("does not consume an old mutation completion after tournament A B A", async () => {
  db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: payload(args.p_tournament_id, 7), error: null }));
  let finish!: (value: unknown) => void;
  db.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<ClockPanel tournamentId="a" />);
  fireEvent.click(await screen.findByRole("button", { name: "tournamentLive.clock.resume" }));
  rerender(<ClockPanel tournamentId="b" />);
  await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(2));
  rerender(<ClockPanel tournamentId="a" />);
  await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(3));
  await act(async () => finish({ data: { ok: true }, error: null }));
  expect(db.rpc).toHaveBeenCalledTimes(3);
});

it("allows B while A is pending and A completion cannot unlock B", async () => {
  db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: payload(args.p_tournament_id, 7), error: null }));
  const finish: Array<(value: unknown) => void> = [];
  db.invoke.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  const { rerender } = render(<ClockPanel tournamentId="a" />);
  fireEvent.click(await screen.findByRole("button", { name: "tournamentLive.clock.resume" }));
  rerender(<ClockPanel tournamentId="b" />);
  const buttonB = await screen.findByRole("button", { name: "tournamentLive.clock.resume" });
  fireEvent.click(buttonB);
  expect(db.invoke).toHaveBeenCalledTimes(2);
  expect(db.invoke.mock.calls[1][1].body.tournament_id).toBe("b");
  await act(async () => finish[0]({ data: { ok: true }, error: null }));
  expect(buttonB).toBeDisabled();
  fireEvent.click(buttonB);
  expect(db.invoke).toHaveBeenCalledTimes(2);
  await act(async () => finish[1]({ data: { ok: true }, error: null }));
});

it("does not let a pending A automatic advance block B or unlock its operation", async () => {
  db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: {
    ...payload(args.p_tournament_id, 7), is_running: true, remaining_seconds: 0,
    next_level: payload(args.p_tournament_id, 8).current_level,
  }, error: null }));
  const finish: Array<(value: unknown) => void> = [];
  db.invoke.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  const { rerender } = render(<ClockPanel tournamentId="a" />);
  await waitFor(() => expect(db.invoke).toHaveBeenCalledTimes(1));
  rerender(<ClockPanel tournamentId="b" />);
  await waitFor(() => expect(db.invoke).toHaveBeenCalledTimes(2));
  expect(db.invoke.mock.calls[1][1].body).toEqual({ tournament_id: "b", action: "next_level", expected_control_revision: "revision-b-7" });
  await act(async () => finish[0]({ data: { ok: true }, error: null }));
  expect(screen.getByRole("button", { name: "tournamentLive.clock.nextLevel" })).toBeDisabled();
  expect(db.invoke).toHaveBeenCalledTimes(2);
  cleanup();
  await act(async () => finish[1]({ data: { ok: true }, error: null }));
});

it("removes controls on logout without issuing anonymous reads or writes", async () => {
  db.rpc.mockResolvedValue({ data: payload("a", 7), error: null });
  const { rerender } = render(<ClockPanel tournamentId="a" />);
  await screen.findByRole("button", { name: "tournamentLive.clock.resume" });
  db.actor = "";
  rerender(<ClockPanel tournamentId="a" />);
  expect(screen.queryByRole("button", { name: "tournamentLive.clock.resume" })).not.toBeInTheDocument();
  expect(db.rpc).toHaveBeenCalledTimes(1);
  expect(db.invoke).not.toHaveBeenCalled();
});

it("does not auto-advance from a late expired prior-tournament snapshot", async () => {
  let old!: (value: unknown) => void;
  db.rpc.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockResolvedValue({ data: payload("b", 7), error: null });
  const { rerender } = render(<ClockPanel tournamentId="a" />);
  await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(1));
  rerender(<ClockPanel tournamentId="b" />);
  await screen.findByRole("button", { name: "tournamentLive.clock.resume" });
  const expired = { ...payload("a", 2), is_running: true, remaining_seconds: 0, next_level: payload("a", 3).current_level };
  await act(async () => old({ data: expired, error: null }));
  expect(db.invoke).not.toHaveBeenCalled();
});

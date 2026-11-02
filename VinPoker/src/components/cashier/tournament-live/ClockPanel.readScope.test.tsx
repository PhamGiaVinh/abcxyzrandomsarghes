import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./TournamentBuyCloseControl", () => ({ TournamentBuyCloseControl: () => null }));

const db = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), error: vi.fn(), success:vi.fn(), actor: "owner" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: db.actor ? { id: db.actor } : null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc, functions: { invoke: db.invoke } } }));
vi.mock("react-i18next", () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
vi.mock("sonner", () => ({ toast: { error: db.error, success: db.success } }));
import { ClockPanel } from "./ClockPanel";

const payload = (id: string, level: number) => ({ tournament_id: id, status: "live", is_running: false,
  elapsed_seconds: 0, remaining_seconds: 600, control_revision: `revision-${id}-${level}`,
  current_level: { id: `level-${level}`, level_number: level, small_blind: 100, big_blind: 200,
    ante: 0, duration_minutes: 10, is_break: false }, next_level: null, is_break: false });
beforeEach(() => { db.rpc.mockReset(); db.invoke.mockReset(); db.error.mockReset();db.success.mockReset(); db.actor = "owner"; });
afterEach(()=>{cleanup();vi.useRealTimers();});
it('ends a hanging automatic mutation without retry and ignores its late success',async()=>{
 db.rpc.mockResolvedValue({data:{...payload('a',7),is_running:true,remaining_seconds:0,next_level:payload('a',8).current_level},error:null});
 let finish!:(value:unknown)=>void;db.invoke.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 vi.useFakeTimers();render(<ClockPanel tournamentId="a"/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(db.invoke).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
 expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được kết quả thao tác đồng hồ');
 expect(screen.getByRole('button',{name:'tournamentLive.clock.refresh'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:'tournamentLive.clock.nextLevel'})).toBeNull();
 expect(screen.getByRole('button',{name:'Manual'})).toBeInTheDocument();
 await act(async()=>{finish({data:{status:'success',clock:payload('a',8)},error:null});await Promise.resolve();});
 expect(db.success).not.toHaveBeenCalled();expect(db.invoke).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'tournamentLive.clock.refresh'}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByText(/tournamentLive.clock.level 7/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Manual'})).toBeInTheDocument();
 expect(db.invoke).toHaveBeenCalledTimes(1);
});
it.each(['business','malformed','transport'])('stops automatic level advancement after a failed attempt instead of issuing it again: %s',async(kind)=>{
 db.rpc.mockResolvedValue({data:{...payload('a',7),is_running:true,remaining_seconds:0,next_level:payload('a',8).current_level},error:null});
 db.invoke.mockImplementationOnce(()=>kind==='transport'?Promise.reject(new Error('offline')):Promise.resolve({data:kind==='business'?{error:'clock_control_failed'}:null,error:null}))
  .mockReturnValue(new Promise(()=>{}));
 render(<ClockPanel tournamentId="a"/>);
 await waitFor(()=>expect(db.error).toHaveBeenCalled());
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(db.invoke).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'Manual'})).toBeInTheDocument();
});
it('ends a hanging clock read and permits manual recovery without accepting its late result',async()=>{
 let old!:(value:unknown)=>void;
 db.rpc.mockReturnValueOnce(new Promise(resolve=>{old=resolve;})).mockResolvedValue({data:payload('a',7),error:null});
 vi.useFakeTimers();render(<ClockPanel tournamentId="a"/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByRole('alert')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'tournamentLive.clock.refresh'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'tournamentLive.clock.refresh'}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText(/tournamentLive.clock.level 7/)).toBeInTheDocument();
 await act(async()=>{old({data:payload('a',2),error:null});await Promise.resolve();});
 expect(screen.queryByText(/tournamentLive.clock.level 2/)).toBeNull();expect(db.invoke).not.toHaveBeenCalled();
});
it.each([null,{ok:true},{status:'success',clock:payload('foreign',7)}])('does not report malformed clock mutation response as success: %j',async(data)=>{
 db.rpc.mockResolvedValue({data:payload('a',7),error:null});db.invoke.mockResolvedValue({data,error:null});
 render(<ClockPanel tournamentId="a"/>);
 fireEvent.click(await screen.findByRole('button',{name:'tournamentLive.clock.resume'}));
 await waitFor(()=>expect(db.error).toHaveBeenCalled());
 expect(db.success).not.toHaveBeenCalled();expect(db.invoke).toHaveBeenCalledTimes(1);
});
it('confirms the canonical clock Edge response for the same tournament and refreshes once',async()=>{
 db.rpc.mockResolvedValue({data:payload('a',7),error:null});
 db.invoke.mockResolvedValue({data:{status:'success',clock:{...payload('a',7),is_running:true}},error:null});
 render(<ClockPanel tournamentId="a"/>);fireEvent.click(await screen.findByRole('button',{name:'tournamentLive.clock.resume'}));
 await waitFor(()=>expect(db.success).toHaveBeenCalledWith('OK'));
 expect(db.error).not.toHaveBeenCalled();expect(db.invoke).toHaveBeenCalledTimes(1);expect(db.rpc).toHaveBeenCalledTimes(2);
});

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

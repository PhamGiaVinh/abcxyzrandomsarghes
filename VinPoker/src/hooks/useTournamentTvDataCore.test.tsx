import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ readTour: vi.fn(), readOrdered: vi.fn(), rpc: vi.fn(), select:vi.fn(), signals:[] as AbortSignal[], client: {} as Record<string,unknown> }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => state.client }));
vi.mock("@/hooks/useLiveClock", () => ({ useLiveClock: () => 0 }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: false } }));
import { useTournamentTvDataCore } from "./useTournamentTvDataCore";
const a = "f7280000-0000-4000-8000-000000000003";
const b = "f7280000-0000-4000-8000-000000000004";
const counts = { total_entries: 8, re_entries: 2, remaining: 6, seated: 4, waiting: 2, busted: 2,
  anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 120000, seated_stack: 80000, waiting_stack: 40000 };
const tourRow = (id: string) => ({ data: { name: id, status: "live", players_remaining: 99, average_stack: 123,
  prize_pool: 0, starting_stack: 20000, guarantee_amount: 0, buy_in: 0, rake_amount: 0, club: null }, error: null });
beforeEach(() => {
  vi.clearAllMocks();
  state.signals=[];
  state.readTour.mockImplementation((id: string) => Promise.resolve(tourRow(id)));
  state.readOrdered.mockImplementation(() => Promise.resolve({ data: [], error: null }));
  state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => Promise.resolve(name === "get_tournament_clock"
    ? { data: { remaining_seconds: 600, is_running: false }, error: null }
    : { data: { tournament_id: args.p_tournament_id, counts, average_stack: 20000, prize_pool:0 }, error: null }));
  state.client = {
    rpc: (...args:unknown[]) => {
      const result = Promise.resolve(state.rpc(...args));
      return Object.assign(result,{abortSignal:(signal:AbortSignal)=>{state.signals.push(signal);return result;}});
    },
    from: (table: string) => {
      let id = ""; let columns = "";
      type QueryDouble={select(c:string):QueryDouble;eq(k:string,v:string):QueryDouble;abortSignal(signal:AbortSignal):QueryDouble;order():Promise<unknown>;maybeSingle():Promise<unknown>;then(resolve:(v:unknown)=>unknown):Promise<unknown>};
      const chain: QueryDouble = { select: (c: string) => { state.select(table,c); columns = c; return chain; },
        eq: (key: string, value: string) => { if (key === "id" || key === "tournament_id") id = value; return chain; },
        abortSignal: (signal:AbortSignal) => {state.signals.push(signal);return chain;},
        order: () => state.readOrdered(table, id),
        maybeSingle: () => columns === "satellite_payout" ? Promise.resolve({ data: null, error: null }) : state.readTour(id),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
      if (table === "tournament_seats") throw new Error("TV must not count seat history");
      return chain;
    },
    channel: () => { const channel: {on:()=>unknown;subscribe:()=>unknown} = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel: vi.fn(),
  };
});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("TV canonical participation and scope", () => {
  it('invalidates an old read when credentials change for the same account',async()=>{
    let finish!:(v:unknown)=>void;
    state.readTour.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {result,rerender}=renderHook(({authEpoch})=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false,authEpoch}),{initialProps:{authEpoch:1}});
    await waitFor(()=>expect(finish).toBeTypeOf('function'));rerender({authEpoch:2});
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    await act(async()=>finish({...tourRow(a),data:{...tourRow(a).data,name:'OLD_CREDENTIAL'}}));
    expect(result.current.data?.tournamentName).toBe(a);
  });
  it('never returns cached TV data from another backend client even for one render',async()=>{
    state.readTour.mockResolvedValueOnce({...tourRow(a),data:{...tourRow(a).data,name:'OLD_BACKEND'}});
    const frames:Array<string|undefined>=[];let changed=false;
    const {result,rerender}=renderHook(()=>{
      const value=useTournamentTvDataCore(a,{userId:'owner',authLoading:false});
      if(changed)frames.push(value.data?.tournamentName);return value;
    });
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    state.client={...state.client};changed=true;rerender();
    await waitFor(()=>expect(result.current.data?.tournamentName).toBe(a));
    expect(frames).not.toContain('OLD_BACKEND');
  });
  it('coalesces burst refreshes while accepting the current slow snapshot',async()=>{
    let finish!:(v:unknown)=>void;
    state.readTour.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {result}=renderHook(()=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    act(()=>{for(let i=0;i<100;i++)void result.current.refetch();});
    expect(state.readTour).toHaveBeenCalledTimes(1);
    await act(async()=>finish(tourRow(a)));
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    expect(state.readTour).toHaveBeenCalledTimes(2);
  });
  it('bounds a hung TV read and ignores its late response',async()=>{
    vi.useFakeTimers();let finish!:(v:unknown)=>void;
    state.readTour.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {result}=renderHook(()=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(result.current.state).toBe('error');
    expect(state.signals[0].aborted).toBe(true);
    await act(async()=>finish(tourRow(a)));
    expect(result.current.state).toBe('error');expect(result.current.data).toBeNull();
  });
  it('contains a rejected refresh instead of rejecting into event callbacks',async()=>{
    const {result}=renderHook(()=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false}));
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    state.readTour.mockRejectedValueOnce(Error('LOCAL_TV_FETCH_REJECTED'));
    await act(async()=>{await expect(result.current.refetch()).resolves.toBeUndefined();});
    expect(result.current.state).toBe('error');expect(result.current.data?.totalChips).toBe(120000);
  });
  it('discards a late funded-pool response after changing tournament',async()=>{
    let resolveOld!:(value:unknown)=>void;
    state.rpc.mockImplementation((name:string,args:{p_tournament_id:string})=>name==='get_tournament_clock'
      ?Promise.resolve({data:{remaining_seconds:600,is_running:false},error:null})
      :args.p_tournament_id===a?new Promise(resolve=>{resolveOld=resolve;})
      :Promise.resolve({data:{tournament_id:b,counts,average_stack:20000,prize_pool:400000},error:null}));
    const {result,rerender}=renderHook(({id})=>useTournamentTvDataCore(id,{userId:'owner',authLoading:false}),{initialProps:{id:a}});
    await waitFor(()=>expect(resolveOld).toBeTypeOf('function'));
    rerender({id:b});
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    expect(result.current.data?.prizePool).toBe(400000);
    await act(async()=>resolveOld({data:{tournament_id:a,counts,average_stack:20000,prize_pool:2500000},error:null}));
    expect(result.current.data?.tournamentName).toBe(b);
    expect(result.current.data?.prizePool).toBe(400000);
  });
  it.each([undefined,-1,Number.NaN,Number.POSITIVE_INFINITY,'2500000'])('rejects unverified canonical funding %s rather than showing Final zero',async(prize_pool)=>{
    state.rpc.mockImplementation((name:string,args:{p_tournament_id:string})=>Promise.resolve(name==='get_tournament_clock'
      ?{data:{remaining_seconds:600,is_running:false},error:null}
      :{data:{tournament_id:args.p_tournament_id,counts,average_stack:20000,prize_pool},error:null}));
    const {result}=renderHook(()=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false}));
    await waitFor(()=>expect(result.current.state).toBe('error'));
    expect(result.current.data).toBeNull();
  });
  it.each([0,null])('keeps explicit canonical funding %s without copying GTD',async(prize_pool)=>{
    state.rpc.mockImplementation((name:string,args:{p_tournament_id:string})=>Promise.resolve(name==='get_tournament_clock'
      ?{data:{remaining_seconds:600,is_running:false},error:null}
      :{data:{tournament_id:args.p_tournament_id,counts,average_stack:20000,prize_pool},error:null}));
    const {result}=renderHook(()=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false}));
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    expect(result.current.data?.prizePool).toBe(prize_pool);
  });
  it('uses canonical finalized-event funding returned with the authorized summary, not raw Final zero or GTD',async()=>{
    state.readTour.mockResolvedValue({...tourRow(a),data:{...tourRow(a).data,main_event:{guarantee_amount:3000000}}});
    state.rpc.mockImplementation((name:string,args:{p_tournament_id:string})=>Promise.resolve(name==='get_tournament_clock'
      ?{data:{remaining_seconds:600,is_running:false},error:null}
      :{data:{tournament_id:args.p_tournament_id,counts,average_stack:20000,prize_pool:2500000},error:null}));
    const {result}=renderHook(()=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false}));
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    expect(result.current.data?.prizePool).toBe(2500000);
    expect(result.current.data?.mainEventGuarantee).toBe(3000000);
  });
  it('reads the parent event GTD separately without replacing child economic fields',async()=>{
    state.readTour.mockResolvedValue({...tourRow(a),data:{...tourRow(a).data,
      main_event:{guarantee_amount:2500000}}});
    const {result}=renderHook(()=>useTournamentTvDataCore(a,{userId:'owner',authLoading:false}));
    await waitFor(()=>expect(result.current.state).toBe('ready'));
    expect(state.select).toHaveBeenCalledWith('tournaments',expect.stringContaining('main_event:tournament_events!tournaments_event_id_fkey(guarantee_amount)'));
    expect(result.current.data?.mainEventGuarantee).toBe(2500000);
    expect(result.current.data?.guarantee).toBe(0);
    expect(result.current.data?.prizePool).toBe(0);
    expect(result.current.data?.playersRemaining).toBe(6);
  });
  it("uses entry aggregates rather than stored counters/seat history", async () => {
    const { result } = renderHook(() => useTournamentTvDataCore(a, { userId: "owner", authLoading: false }));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(state.rpc).toHaveBeenCalledWith("get_tournament_participation_counts_v1", { p_tournament_id: a });
    expect(JSON.stringify(result.current.data)).not.toContain('"playersRemaining":99');
    expect(result.current.data?.totalEntries).toBe(8);
    expect(result.current.data?.reEntries).toBe(2);
    expect(result.current.data?.totalChips).toBe(120000);
  });
  it("does not report ready when participation read fails", async () => {
    state.rpc.mockImplementation((name: string) => Promise.resolve(name === "get_tournament_clock"
      ? { data: { remaining_seconds: 600 }, error: null } : { data: null, error: { message: "503" } }));
    const { result } = renderHook(() => useTournamentTvDataCore(a, { userId: "owner", authLoading: false }));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.data).toBeNull();
  });
  it.each(["tournament_levels", "tournament_prizes"])("does not turn a failed %s read into an empty ready display", async (failedTable) => {
    state.readOrdered.mockImplementation((table: string) => Promise.resolve(table === failedTable
      ? { data: null, error: { message: "503 temporary read failure" } }
      : { data: [], error: null }));
    const { result } = renderHook(() => useTournamentTvDataCore(a, { userId: "owner", authLoading: false }));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.data).toBeNull();
    // Successful empty is valid; only unavailable must be distinguished.
    state.readOrdered.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    await act(async () => result.current.refetch());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.data?.totalChips).toBe(120000);
    expect(result.current.data?.playersRemaining).toBe(6);
    state.readOrdered.mockImplementation((table: string) => Promise.resolve(table === failedTable
      ? { data: null, error: { message: "refresh unavailable" } } : { data: [], error: null }));
    await act(async () => result.current.refetch());
    expect(result.current.state).toBe("error");
    // Last-good data belongs to the same scope, never a fabricated zero.
    expect(result.current.data?.totalChips).toBe(120000);
    state.readOrdered.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    await act(async () => result.current.refetch());
    expect(result.current.state).toBe("ready");
  });
  it("ignores delayed old tournament response", async () => {
    let resolveA!: (v: unknown) => void;
    state.readTour.mockImplementation((id: string) => id === a ? new Promise((resolve) => { resolveA = resolve; }) : Promise.resolve(tourRow(id)));
    const { result, rerender } = renderHook(({ id }) => useTournamentTvDataCore(id, { userId: "owner", authLoading: false }), { initialProps: { id: a } });
    await waitFor(() => expect(state.readTour).toHaveBeenCalledWith(a));
    rerender({ id: b });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    await act(async () => resolveA(tourRow(a)));
    expect(result.current.data?.tournamentName).toBe(b);
  });
  it("discards a response from the previous signed-in account in the same tour", async () => {
    let resolveOld!: (v: unknown) => void;
    state.readTour.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ userId }) => useTournamentTvDataCore(a, { userId, authLoading: false }),
      { initialProps: { userId: "owner-a" } });
    await waitFor(() => expect(state.readTour).toHaveBeenCalledOnce());
    rerender({ userId: "owner-b" });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    await act(async () => resolveOld({ ...tourRow(a), data: { ...tourRow(a).data, name: "OLD ACCOUNT" } }));
    expect(result.current.data?.tournamentName).toBe(a);
  });
});

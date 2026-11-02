import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "owner-a" }, session: {access_token:'synthetic-session-a'}, query: vi.fn(),scoreQuery:vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user,session:state.session }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {rpc:(name:string,args:unknown)=>({abortSignal:(signal:AbortSignal)=>state.scoreQuery(name,args,signal)}), from: () => ({ select: () => ({
  in: (_column: string, clubs: string[]) => ({ is: () => ({ order: () => ({abortSignal:(signal:AbortSignal)=>state.query(clubs,signal)}) }) }),
}) }) } }));
import { useAllDealers,useDealerScores } from "./useDealerManagement";
beforeEach(() => { vi.clearAllMocks(); state.query.mockReset(); state.scoreQuery.mockReset(); state.user = { id: "owner-a" }; state.session={access_token:'synthetic-session-a'}; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("Dealer management read scope", () => {
  it('reads scores from the server-authorized club RPC',async()=>{
    state.scoreQuery.mockResolvedValue({data:[{dealer_id:'d',full_name:'TEST',tier:'A',club_id:'club-a',employment_type:'part_time',total_hours:8,total_swings:2,score:29}],error:null});
    const view=renderHook(()=>useDealerScores('club-a'));
    await waitFor(()=>expect(view.result.current.loading).toBe(false));
    expect(view.result.current.error).toBeNull();expect(view.result.current.data[0]?.score).toBe(29);
    expect(state.scoreQuery).toHaveBeenCalledWith('get_dealer_scores_v1',{p_club_id:'club-a'},expect.any(AbortSignal));
  });
  it.each([null,[{dealer_id:'d',club_id:'other-club'}]])('does not accept malformed score response %j',async data=>{
    state.scoreQuery.mockResolvedValue({data,error:null});
    const view=renderHook(()=>useDealerScores('club-a'));
    await waitFor(()=>expect(view.result.current.loading).toBe(false));
    expect(view.result.current.error).toBeTruthy();expect(view.result.current.data).toEqual([]);
  });
  it('invalidates same-actor rows when the authenticated session is replaced',async()=>{
    state.query.mockResolvedValueOnce({data:[{id:'previous-session-dealer'}],error:null})
      .mockResolvedValueOnce({data:null,error:{message:'503 new session'}});
    const view=renderHook(()=>useAllDealers(['club-a']));
    await waitFor(()=>expect(view.result.current.data).toHaveLength(1));
    state.session={access_token:'synthetic-session-b'};view.rerender();
    expect(view.result.current.data).toEqual([]);
    await waitFor(()=>expect(view.result.current.error).toBe('503 new session'));
  });
  it('does not accept a late response from a replaced same-actor session',async()=>{
    let oldFinish!:(value:unknown)=>void;
    state.query.mockImplementationOnce(()=>new Promise(resolve=>{oldFinish=resolve;}))
      .mockResolvedValueOnce({data:[{id:'new-session-dealer'}],error:null});
    const view=renderHook(()=>useAllDealers(['club-a']));
    state.session={access_token:'synthetic-session-b'};view.rerender();
    await act(async()=>oldFinish({data:[{id:'previous-session-dealer'}],error:null}));
    await waitFor(()=>expect(view.result.current.data[0]?.id).toBe('new-session-dealer'));
    expect(state.query.mock.calls[0][1].aborted).toBe(true);
  });
  it('bounds a hung read and ignores late rows after explicit recovery',async()=>{
    let finish!:(value:unknown)=>void;
    state.query.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
      .mockResolvedValueOnce({data:[{id:'recovered-dealer'}],error:null});
    vi.useFakeTimers();
    const view=renderHook(()=>useAllDealers(['club-a']));
    await act(async()=>{await vi.advanceTimersByTimeAsync(15001);});
    expect(view.result.current.loading).toBe(false);expect(view.result.current.error).toBeTruthy();
    expect(state.query.mock.calls[0][1].aborted).toBe(true);
    await act(async()=>view.result.current.refetch());
    expect(view.result.current.data[0]?.id).toBe('recovered-dealer');
    await act(async()=>finish({data:[{id:'late-dealer'}],error:null}));
    expect(view.result.current.data[0]?.id).toBe('recovered-dealer');
  });
  it('coalesces repeated refetches in the same scope',async()=>{
    let finish!:(value:unknown)=>void;
    state.query.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderHook(()=>useAllDealers(['club-a']));
    await waitFor(()=>expect(state.query).toHaveBeenCalledOnce());
    act(()=>{view.result.current.refetch();view.result.current.refetch();view.result.current.refetch();});
    expect(state.query).toHaveBeenCalledOnce();
    await act(async()=>finish({data:[],error:null}));
    expect(view.result.current.loading).toBe(false);
  });
  it("discards a delayed previous-club response", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    state.query.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [{ id: "dealer-b" }], error: null });
    const view = renderHook(({ clubs }) => useAllDealers(clubs), { initialProps: { clubs: ["club-a"] } });
    view.rerender({ clubs: ["club-b"] });
    await waitFor(() => expect(view.result.current.data[0]?.id).toBe("dealer-b"));
    await act(async () => resolveOld({ data: [{ id: "dealer-a" }], error: null }));
    expect(view.result.current.data[0]?.id).toBe("dealer-b");
  });
  it("clears another actor's rows and reports a network failure honestly", async () => {
    state.query.mockResolvedValueOnce({ data: [{ id: "private-dealer-a" }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "503 unavailable" } });
    const view = renderHook(() => useAllDealers(["club-a"]));
    await waitFor(() => expect(view.result.current.data).toHaveLength(1));
    state.user = { id: "owner-b" }; view.rerender();
    await waitFor(() => expect(view.result.current.error).toBe("503 unavailable"));
    expect(view.result.current.data).toEqual([]);
  });
  it("does not poll a hidden tab", async () => {
    state.query.mockResolvedValue({ data: [], error: null });
    renderHook(() => useAllDealers(["club-a"]));
    await waitFor(() => expect(state.query).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(state.query).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});

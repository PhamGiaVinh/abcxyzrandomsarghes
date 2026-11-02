import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), removeChannel:vi.fn(), signals:[] as AbortSignal[], configs:[] as (()=>void)[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc:(...args:unknown[])=>{
 const promise=Promise.resolve(state.rpc(...args));
 return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{state.signals.push(signal);return promise;}});
},
 channel:()=>{const channel={on:(_type:string,_filter:unknown,callback:()=>void)=>{state.configs.push(callback);return channel;},subscribe:()=>channel};return channel;},removeChannel:state.removeChannel } }));
vi.mock("@/hooks/useLiveClock", () => ({ useLiveClock: () => 0 }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: true } }));
import { useTvDisplayState } from "./useTvDisplayState";

function paired(name:string) {
 return {data:{status:'paired',display:{id:name,name,layout:'clock',theme:'dark',club_name:'TEST'},
  tournament:{id:name,name,status:'live',players_remaining:1,average_stack:20000,prize_pool:100000},
  clock:{tournament_id:name,is_running:false,remaining_seconds:600,current_level:{level_number:1,small_blind:100,big_blind:200,ante:0,duration_minutes:20,is_break:false}},
  participation_counts:{total_entries:1,re_entries:0,remaining:1,seated:1,waiting:0,busted:0,anomaly_entries:0,anomaly_seats:0,live_entry_stack:20000,seated_stack:20000,waiting_stack:0},
  entries:{total_confirmed:1,total_buy_ins:100000},re_entries:0,levels:[],prizes:[]},error:null};
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
  vi.spyOn(navigator,"onLine","get").mockReturnValue(true);
  state.rpc.mockReset();
  state.signals=[];
  state.configs=[];
  state.rpc.mockResolvedValue({ data: { status: "invalid" }, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("paired display transport recovery", () => {
  it('does not start a read through a retained refetch after unmount', async () => {
    state.rpc.mockResolvedValue(paired('CURRENT TV'));
    const {result,unmount}=renderHook(()=>useTvDisplayState('flight-A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    const refetch=result.current.refetch;expect(state.rpc).toHaveBeenCalledOnce();
    unmount();await act(async()=>{await refetch();});
    expect(state.rpc).toHaveBeenCalledOnce();
  });
  it('ignores a queued broadcast callback after its channel is removed', async () => {
    state.rpc.mockResolvedValue(paired('CURRENT TV'));
    const {unmount}=renderHook(()=>useTvDisplayState('flight-A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(state.configs).toHaveLength(1);const config=state.configs[0];
    unmount();await act(async()=>{config();await vi.advanceTimersByTimeAsync(0);});
    expect(state.rpc).toHaveBeenCalledOnce();
  });
  it.each(['hidden','offline'])('does not poll while %s and resumes from its browser event',async(mode)=>{
    const visibility=vi.spyOn(document,'visibilityState','get');const network=vi.spyOn(navigator,'onLine','get');
    if(mode==='hidden')visibility.mockReturnValue('hidden');else network.mockReturnValue(false);
    state.rpc.mockResolvedValue(paired('CURRENT TV'));
    const {result}=renderHook(()=>useTvDisplayState('flight-A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(state.rpc).not.toHaveBeenCalled();
    if(mode==='offline')expect(result.current.offline).toBe(true);
    visibility.mockReturnValue('visible');network.mockReturnValue(true);
    await act(async()=>{if(mode==='hidden')document.dispatchEvent(new Event('visibilitychange'));else window.dispatchEvent(new Event('online'));});
    expect(state.rpc).toHaveBeenCalledOnce();expect(result.current.data?.tournamentName).toBe('CURRENT TV');
  });
  it('marks a disconnected same-token snapshot stale without polling until reconnect',async()=>{
    state.rpc.mockResolvedValue(paired('CURRENT TV'));const {result}=renderHook(()=>useTvDisplayState('flight-A'));
    await act(async()=>{});expect(result.current.offline).toBe(false);
    vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
    await act(async()=>{window.dispatchEvent(new Event('offline'));await vi.advanceTimersByTimeAsync(60000);});
    expect(state.rpc).toHaveBeenCalledOnce();expect(result.current.offline).toBe(true);expect(result.current.data?.tournamentName).toBe('CURRENT TV');
    vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
    await act(async()=>{window.dispatchEvent(new Event('online'));});expect(state.rpc).toHaveBeenCalledTimes(2);expect(result.current.offline).toBe(false);
  });

  it('treats an empty successful response as unavailable and retries without invalidating pairing',async()=>{
    state.rpc.mockResolvedValueOnce({data:null,error:null});
    const {result}=renderHook(()=>useTvDisplayState('flight-A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(result.current.state).toBe('error');
    expect(result.current.offline).toBe(true);
    state.rpc.mockResolvedValue(paired('RECOVERED A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(result.current.state).toBe('ready');
    expect(result.current.data?.tournamentName).toBe('RECOVERED A');
  });
  it('bounds a hung kiosk read and refuses its late snapshot',async()=>{
    let finish!:(value:unknown)=>void;
    state.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {result}=renderHook(()=>useTvDisplayState('flight-A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(result.current.state).toBe('error');expect(result.current.offline).toBe(true);
    expect(state.signals[0].aborted).toBe(true);
    await act(async()=>finish(paired('LATE FLIGHT A')));
    expect(result.current.state).toBe('error');expect(result.current.data).toBeNull();
    state.rpc.mockResolvedValue(paired('RECOVERED A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(result.current.data?.tournamentName).toBe('RECOVERED A');
  });
  it('coalesces repeated refreshes without discarding the current slow snapshot',async()=>{
    let finish!:(value:unknown)=>void;
    state.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {result}=renderHook(()=>useTvDisplayState('flight-A'));
    act(()=>{for(let i=0;i<30;i++)void result.current.refetch();});
    expect(state.rpc).toHaveBeenCalledTimes(1);
    state.rpc.mockResolvedValue(paired('CURRENT A'));
    await act(async()=>finish(paired('CURRENT A')));
    expect(result.current.data?.tournamentName).toBe('CURRENT A');
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });
  it('never renders a previous flight even in the first frame of a token change',async()=>{
    state.rpc.mockResolvedValueOnce(paired('FLIGHT A'));
    const frames:Array<string|undefined>=[];let changed=false;
    const {result,rerender}=renderHook(({token})=>{
      const value=useTvDisplayState(token);if(changed)frames.push(value.data?.tournamentName);return value;
    },{initialProps:{token:'flight-A'}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(result.current.data?.tournamentName).toBe('FLIGHT A');
    state.rpc.mockImplementationOnce(()=>new Promise(()=>{}));
    changed=true;rerender({token:'flight-B'});
    expect(frames).not.toContain('FLIGHT A');expect(result.current.payload).toBeNull();
  });
  it('aborts unmounted reads and never schedules another poll from their completion',async()=>{
    let finish!:(value:unknown)=>void;
    state.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {unmount}=renderHook(()=>useTvDisplayState('flight-A'));
    unmount();expect(state.signals[0].aborted).toBe(true);
    await act(async()=>finish(paired('UNMOUNTED')));
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it('retains only same-token last-good data on refresh timeout and recovers',async()=>{
    state.rpc.mockResolvedValueOnce(paired('FLIGHT A'));
    const {result}=renderHook(()=>useTvDisplayState('flight-A'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    state.rpc.mockImplementationOnce(()=>new Promise(()=>{}));
    act(()=>{void result.current.refetch();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(result.current.state).toBe('ready');expect(result.current.offline).toBe(true);
    expect(result.current.data?.tournamentName).toBe('FLIGHT A');
    state.rpc.mockResolvedValue(paired('RECOVERED A'));
    await act(async()=>{await result.current.refetch();});
    expect(result.current.offline).toBe(false);expect(result.current.data?.tournamentName).toBe('RECOVERED A');
  });
  it("surfaces initial fetch rejection then continues the bounded poll loop", async () => {
    state.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useTvDisplayState("synthetic-display-token"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("error");
    expect(result.current.offline).toBe(true);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("invalid");
    expect(result.current.offline).toBe(false);
  });
});


describe('TV prize read contract',()=>{
 it.each([
  ['object',{}],['null row',[null]],['invalid amount',[{position:1,amount:'not-money'}]],
  ['duplicate rank',[{position:1,amount:570000},{position:1,amount:300000}]],
  ['invalid rank',[{position:0,amount:570000}]],
 ])('keeps the last verified TV prize snapshot after a malformed %s',async(_kind,prizes)=>{
  const healthy={...paired('PRIZES'),data:{...paired('PRIZES').data,prizes:[{position:1,amount:570000}]}};
  state.rpc.mockResolvedValue(healthy);
  const {result}=renderHook(()=>useTvDisplayState('LOCAL-prize-test'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(result.current.data?.prizes).toEqual([{position:1,amount:570000}]);
  state.rpc.mockResolvedValue({...healthy,data:{...healthy.data,prizes}});
  await act(async()=>{await result.current.refetch();});
  expect(result.current.offline).toBe(true);expect(result.current.state).toBe('ready');
  expect(result.current.data?.prizes).toEqual([{position:1,amount:570000}]);
  state.rpc.mockResolvedValue(healthy);
  await act(async()=>{await result.current.refetch();});
  expect(result.current.offline).toBe(false);
  expect(result.current.data?.prizes).toEqual([{position:1,amount:570000}]);
 });
});

it.each([
 ['missing',undefined,[]],['null',null,[]],['empty',[],[]],
 ['numeric string',[{position:1,amount:'570000'}],[{position:1,amount:570000}]],
])('retains the existing %s prize read contract',async(_kind,prizes,expected)=>{
 state.rpc.mockResolvedValue({...paired('COMPAT'),data:{...paired('COMPAT').data,prizes}});
 const {result}=renderHook(()=>useTvDisplayState('LOCAL-compat-test'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(result.current.state).toBe('ready');expect(result.current.offline).toBe(false);
 expect(result.current.data?.prizes).toEqual(expected);
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>({user:{id:'actor'},session:null,loading:false})}));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { rpc: h.rpc };
  return { useSupabaseClient: () => client };
});
import { MultiDayBaggingPanel } from "./MultiDayBaggingPanel";
import { parseMultiDayBaggingState, validBaggingReceipt } from "./multiDayBaggingState";

const playerId = "60000000-0000-0000-0000-000000000001";
const state = {
  status: "bagging" as const, dayNumber: 1, dayVersion: 0, rosterHash: "abc", manager: true,
  rows: [{ playerId, seatNumber: 3, trackedStack: 100000,
    bagCode: null, bagTotal: null, bagRevision: 0, sealed: false, sealedVersion: null }],
};
const saved = {ok:true,bagId:'70000000-0000-0000-0000-000000000001',revision:1,
  trackedStack:100000,bagTotal:100000,variance:0,sealed:false,idempotent:false};
const recoveryPayload={p_flight_tournament_id:'flight-id',p_player_id:playerId,p_bag_code:'BAG-01',p_total_value:100000,p_expected_revision:0};
const recovered={found:true,actorId:'actor',flightTournamentId:'flight-id',requestId:'request-id',action:'edit',playerId,payload:recoveryPayload,result:saved};

beforeEach(() => {
  sessionStorage.clear();
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => name === "multi_day_bagging_state_v1"
    ? { data: state, error: null } : { data: saved, error: null });
  vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
});
afterEach(()=>vi.useRealTimers());

describe("flight bagging UI", () => {
  it('only retries the saved payload and key after an explicit missing-receipt check',async()=>{
    let writes=0;
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_bagging_state_v1'?{data:state,error:null}
      :name==='multi_day_get_bagging_receipt_v2'?{data:{found:false},error:null}
      :++writes===1?{data:null,error:{message:'network unavailable'}}:{data:saved,error:null});
    const view=render(<MultiDayBaggingPanel tournamentId="flight-id"/>);
    await screen.findByText(/Tracker stack: 100,000/);
    fireEvent.change(screen.getByRole('textbox',{name:`Bag code for ${playerId}`}),{target:{value:'BAG-01'}});
    fireEvent.change(screen.getByRole('spinbutton',{name:`Bag total for ${playerId}`}),{target:{value:'100000'}});
    fireEvent.click(screen.getByRole('button',{name:'Save'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('response could not be verified');
    view.unmount();render(<MultiDayBaggingPanel tournamentId="flight-id"/>);
    await screen.findByText(/Tracker stack: 100,000/);
    expect(writes).toBe(1);
    expect(screen.queryByRole('button',{name:'Retry saved request'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Check saved request'}));
    fireEvent.click(await screen.findByRole('button',{name:'Retry saved request'}));
    await screen.findByText('Bag total recorded. A Chip Master must seal it.');
    const calls=h.rpc.mock.calls.filter(([name])=>name==='multi_day_record_bag_v1');
    expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual(calls[0][1]);
    expect(sessionStorage.length).toBe(0);
  });
  it('validates save, seal and close receipts against their exact operation',()=>{
    const args={p_player_id:playerId,p_expected_revision:0,p_total_value:100000};
    expect(validBaggingReceipt('multi_day_record_bag_v1',args,state,saved)).toBe(true);
    for(const invalid of [{...saved,revision:2},{...saved,bagTotal:999},{...saved,variance:1},
      {...saved,trackedStack:1},{...saved,bagId:'invalid'},{...saved,sealed:true}]) {
      expect(validBaggingReceipt('multi_day_record_bag_v1',args,state,invalid)).toBe(false);
    }
    const sealState={...state,rows:[{...state.rows[0],bagCode:'BAG-01',bagTotal:100000,bagRevision:1}]};
    const sealed={...saved,revision:2,sealed:true,sealedVersion:2,bagCode:'BAG-01'};
    expect(validBaggingReceipt('multi_day_seal_bag_v1',{p_player_id:playerId,p_expected_revision:1},sealState,sealed)).toBe(true);
    expect(validBaggingReceipt('multi_day_seal_bag_v1',{p_player_id:playerId,p_expected_revision:1},sealState,{...sealed,bagCode:'OTHER'})).toBe(false);
    const closed={ok:true,idempotent:false,status:'locked',rosterHash:'abc',bagCount:1,expectedTotal:100000,countedTotal:100000,dayVersion:1};
    expect(validBaggingReceipt('multi_day_close_bagging_v1',{p_expected_day_version:0},state,closed)).toBe(true);
    expect(validBaggingReceipt('multi_day_close_bagging_v1',{p_expected_day_version:0},state,{...closed,rosterHash:'other'})).toBe(false);
    expect(validBaggingReceipt('multi_day_close_bagging_v1',{p_expected_day_version:0},state,{...closed,countedTotal:0})).toBe(false);
  });
  it("does not accept an ok-only save response as a committed bag", async () => {
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_bagging_state_v1'
      ?{data:state,error:null}:{data:{ok:true},error:null});
    render(<MultiDayBaggingPanel tournamentId="flight-id"/>);
    await screen.findByText(/Tracker stack: 100,000/);
    fireEvent.change(screen.getByRole('textbox',{name:`Bag code for ${playerId}`}),{target:{value:'BAG-01'}});
    fireEvent.change(screen.getByRole('spinbutton',{name:`Bag total for ${playerId}`}),{target:{value:'100000'}});
    fireEvent.click(screen.getByRole('button',{name:'Save'}));
    await waitFor(()=>expect(screen.queryByText('Bag total recorded. A Chip Master must seal it.')).toBeNull());
    await screen.findByRole('alert');
  });
  it("recovers a timed-out save by its original request id without resubmitting", async () => {
    vi.useFakeTimers();
    let finishLate!: (result: unknown) => void;
    h.rpc.mockImplementation((name:string)=>name==='multi_day_bagging_state_v1'
      ?Promise.resolve({data:state,error:null}):name==='multi_day_get_bagging_receipt_v2'
        ?Promise.resolve({data:recovered,error:null}):new Promise(resolve=>{finishLate=resolve;}));
    render(<MultiDayBaggingPanel tournamentId="flight-id"/>);
    await act(async()=>{});
    fireEvent.change(screen.getByRole('textbox',{name:`Bag code for ${playerId}`}),{target:{value:'BAG-01'}});
    fireEvent.change(screen.getByRole('spinbutton',{name:`Bag total for ${playerId}`}),{target:{value:'100000'}});
    fireEvent.click(screen.getByRole('button',{name:'Save'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check saved request'}));});
    expect(screen.getByText('Bag total recorded. A Chip Master must seal it.')).toBeTruthy();
    const calls=h.rpc.mock.calls.filter(([name])=>name==='multi_day_record_bag_v1');
    expect(calls).toHaveLength(1);
    expect(h.rpc).toHaveBeenCalledWith('multi_day_get_bagging_receipt_v2',{p_flight_tournament_id:'flight-id',p_request_id:calls[0][1].p_request_id,p_expected_payload:recoveryPayload});
    await act(async()=>finishLate({data:null,error:{message:'late failure'}}));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("ends a hung roster read and ignores its late completion after retry", async () => {
    vi.useFakeTimers();
    let finishLate!: (result: unknown) => void;
    h.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finishLate=resolve;}));
    render(<MultiDayBaggingPanel tournamentId="flight-id"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
    expect(screen.queryByText('Loading frozen flight roster…')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Refresh'}));});
    expect(screen.getByText(/Tracker stack: 100,000/)).toBeTruthy();
    await act(async()=>finishLate({data:{...state,rows:[{...state.rows[0],trackedStack:999}]},error:null}));
    expect(screen.queryByText(/Tracker stack: 999/)).toBeNull();
  });

  it("ignores a previous flight read completing after the current flight", async () => {
    let finishOld!: (result: unknown) => void;
    h.rpc.mockImplementation((_name:string,args:Record<string,unknown>) => args.p_flight_tournament_id==='old'
      ?new Promise(resolve=>{finishOld=resolve;})
      :Promise.resolve({data:{...state,rows:[{...state.rows[0],trackedStack:200000}]},error:null}));
    const view=render(<MultiDayBaggingPanel tournamentId="old"/>);
    view.rerender(<MultiDayBaggingPanel tournamentId="new"/>);
    await screen.findByText(/Tracker stack: 200,000/);
    await act(async()=>finishOld({data:state,error:null}));
    expect(screen.queryByText(/Tracker stack: 100,000/)).toBeNull();
    expect(screen.getByText(/Tracker stack: 200,000/)).toBeTruthy();
  });

  it("does not reload the old flight or show its success after switching during a save", async () => {
    let finishSave!: (result: unknown) => void;
    h.rpc.mockImplementation((name:string)=>name==='multi_day_bagging_state_v1'
      ?Promise.resolve({data:state,error:null}):new Promise(resolve=>{finishSave=resolve;}));
    const view=render(<MultiDayBaggingPanel tournamentId="old"/>);
    await screen.findByText(/Tracker stack: 100,000/);
    fireEvent.change(screen.getByRole('textbox',{name:`Bag code for ${playerId}`}),{target:{value:'BAG-01'}});
    fireEvent.change(screen.getByRole('spinbutton',{name:`Bag total for ${playerId}`}),{target:{value:'100000'}});
    fireEvent.click(screen.getByRole('button',{name:'Save'}));
    view.rerender(<MultiDayBaggingPanel tournamentId="new"/>);
    await screen.findByText(/Tracker stack: 100,000/);
    await act(async()=>finishSave({data:{ok:true},error:null}));
    expect(screen.queryByText('Bag total recorded. A Chip Master must seal it.')).toBeNull();
    expect(h.rpc.mock.calls.filter(([name,args])=>name==='multi_day_bagging_state_v1'&&args.p_flight_tournament_id==='old')).toHaveLength(1);
  });

  it("rejects a malformed server roster rather than treating it as empty", () => {
    expect(() => parseMultiDayBaggingState({ ...state, rows: [{ ...state.rows[0], trackedStack: "100000" }] }))
      .toThrow("Bagging roster is invalid.");
  });

  it("shows a loading state, then submits explicit total and expected revision", async () => {
    render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    expect(screen.getByText("Loading frozen flight roster…")).toBeTruthy();
    await screen.findByText(/Tracker stack: 100,000/);
    expect(screen.getByRole("button", { name: "Seal" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: `Bag code for ${playerId}` }),
      { target: { value: "BAG-01" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: `Bag total for ${playerId}` }),
      { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("multi_day_record_bag_v1", {
      p_flight_tournament_id: "flight-id",p_player_id: playerId,p_bag_code: "BAG-01",
      p_total_value: 100000,p_expected_revision: 0,p_request_id: "request-id",
    }));
  });

  it("holds actions when the server read fails", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "multi_day_bagging_not_open" } });
    render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    await screen.findByRole("alert");
    expect(screen.getByText("End Flight has not opened bagging for this flight.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("restores an uncertain save across remount and only reads its original receipt", async () => {
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "multi_day_bagging_state_v1") return { data: state, error: null };
      return name==='multi_day_get_bagging_receipt_v2'?{data:recovered,error:null}
        :{ data: null, error: { message: "network unavailable" } };
    });
    const view=render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    await screen.findByText(/Tracker stack: 100,000/);
    fireEvent.change(screen.getByRole("textbox", { name: `Bag code for ${playerId}` }),
      { target: { value: "BAG-01" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: `Bag total for ${playerId}` }),
      { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    view.unmount();
    render(<MultiDayBaggingPanel tournamentId="flight-id"/>);
    await screen.findByRole('button',{name:'Check saved request'});
    fireEvent.click(screen.getByRole('button',{name:'Check saved request'}));
    await screen.findByText('Bag total recorded. A Chip Master must seal it.');
    const calls = h.rpc.mock.calls.filter(([name]) => name === "multi_day_record_bag_v1");
    expect(calls).toHaveLength(1);
    expect(h.rpc).toHaveBeenCalledWith('multi_day_get_bagging_receipt_v2',{p_flight_tournament_id:'flight-id',p_request_id:calls[0][1].p_request_id,p_expected_payload:recoveryPayload});
  });

  it("keeps seal and close unavailable for dealer-only read scope", async () => {
    h.rpc.mockResolvedValue({ data: { ...state, manager: false }, error: null });
    render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    await screen.findByText(/Tracker stack: 100,000/);
    expect(screen.queryByRole("button", { name: "Seal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock flight bagging" })).toBeNull();
  });
});

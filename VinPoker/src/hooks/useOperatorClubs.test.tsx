import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: { user: { id: "owner-1", email: "owner@example.test" } as {id:string;email:string}|null, loading: false, session: null as {access_token:string}|null },
  rpc: vi.fn(),
  clubIn: vi.fn(),
  signals:[] as AbortSignal[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args:unknown[]) => Object.assign(h.rpc(...args),{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return h.rpc.mock.results.at(-1)!.value;}}),
    from: () => ({ select: () => ({ in: (...args:unknown[]) => {const response=h.clubIn(...args);return Object.assign(response,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return response;}});} }) }),
  },
}));

import { useOperatorClubs } from "./useOperatorClubs";

describe("useOperatorClubs auth refresh stability", () => {
  afterEach(()=>{cleanup();vi.useRealTimers();});
  beforeEach(() => {
    h.auth = { user: { id: "owner-1", email: "owner@example.test" }, loading: false, session:null };
    h.rpc.mockReset();
    h.clubIn.mockReset();
    h.signals=[];
    h.rpc.mockImplementation(async (name: string) => name === "get_my_floor_operator_scope"
      ? { data: [{ club_id: "club-1", can_owner: true, can_cashier: true, can_floor: true }], error: null }
      : { data: [], error: null });
    h.clubIn.mockResolvedValue({ data: [{ id: "club-1", name: "Centerpoint" }], error: null });
  });

  it("keeps Floor scope loaded when Supabase replaces the User object for the same actor", async () => {
    const { result, rerender } = renderHook(() => useOperatorClubs());

    await waitFor(() => expect(result.current.clubs).toEqual([{ id: "club-1", name: "Centerpoint" }]));
    expect(h.rpc).toHaveBeenCalledTimes(2);

    h.auth = { user: { id: "owner-1", email: "refreshed@example.test" }, loading: false, session:null };
    rerender();

    expect(result.current.clubs).toEqual([{ id: "club-1", name: "Centerpoint" }]);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it('does not classify a Dealer scope RPC error as verified missing membership',async()=>{
    h.rpc.mockImplementation(async(name:string)=>name==='dealer_control_club_ids'?{data:null,error:{message:'503'}}:{data:[],error:null});
    const {result}=renderHook(()=>useOperatorClubs());
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.dealerClubIds).toEqual([]);
  });

  it('ends hung scope reads and permits an explicit read retry',async()=>{
    vi.useFakeTimers();const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(()=>new Promise(()=>{}));
    const {result}=renderHook(()=>useOperatorClubs());
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
    expect(result.current.loading).toBe(false);expect(result.current.error).toContain('Hết thời gian');
    expect(h.signals.every(signal=>signal.aborted)).toBe(true);
    h.rpc.mockImplementation(normal);
    await act(async()=>{result.current.refresh();});
    expect(result.current.error).toBeNull();expect(result.current.hasCashierAccess).toBe(true);
  });

  it('does not expose old actor capability IDs even in the first render after actor switch',async()=>{
    const seen:{actor:string;ids:string[]}[]=[];
    const {result,rerender}=renderHook(()=>{const value=useOperatorClubs();seen.push({actor:h.auth.user?.id??'',ids:value.operatorClubIds});return value;});
    await waitFor(()=>expect(result.current.hasCashierAccess).toBe(true));
    h.rpc.mockImplementation(()=>new Promise(()=>{}));
    h.auth={user:{id:'owner-2',email:'second@example.test'},loading:false,session:null};rerender();
    expect(seen.filter(row=>row.actor==='owner-2').every(row=>row.ids.length===0)).toBe(true);
    expect(result.current.hasCashierAccess).toBe(false);expect(result.current.operatorClubIds).toEqual([]);expect(result.current.clubs).toBeNull();
  });

  it('keeps server-verified roles when only optional club-name metadata fails',async()=>{
    h.clubIn.mockResolvedValue({data:null,error:{message:'503 names'}});
    const {result}=renderHook(()=>useOperatorClubs());
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.scopeVerified).toBe(true);expect(result.current.hasCashierAccess).toBe(true);
    expect(result.current.operatorClubIds).toEqual(['club-1']);expect(result.current.clubs).toEqual([]);
    expect(result.current.error).toContain('tên CLB');
  });

  it.each([null,{},[{club_id:'club-1',can_owner:'yes'}]])('rejects malformed scope payload %j rather than granting or claiming empty scope',async data=>{
    h.rpc.mockImplementation(async(name:string)=>({data:name==='get_my_floor_operator_scope'?data:[],error:null}));
    const {result}=renderHook(()=>useOperatorClubs());
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain('không hợp lệ');expect(result.current.hasCashierAccess).toBe(false);expect(result.current.scopeVerified).toBe(false);
  });

  it('surfaces a thrown read and aborts the SDK requests on unmount',async()=>{
    h.rpc.mockImplementation(()=>Promise.reject(new Error('transport rejected')));
    const {result,unmount}=renderHook(()=>useOperatorClubs());
    await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.error).toBe('transport rejected');
    unmount();expect(h.signals.every(signal=>signal.aborted)).toBe(true);
  });

  it('requires fresh verification after logout and a new login of the same actor',async()=>{
    let phase='initial';const seen:{phase:string;verified:boolean}[]=[];
    const {result,rerender}=renderHook(()=>{const value=useOperatorClubs();seen.push({phase,verified:value.scopeVerified});return value;});
    await waitFor(()=>expect(result.current.scopeVerified).toBe(true));
    phase='logout';h.auth.user=null;rerender();expect(result.current.clubs).toEqual([]);
    phase='login';h.rpc.mockImplementation(()=>new Promise(()=>{}));h.auth.user={id:'owner-1',email:'new-login@example.test'};rerender();
    expect(seen.filter(row=>row.phase==='login').every(row=>!row.verified)).toBe(true);
    expect(result.current.loading).toBe(true);expect(result.current.hasCashierAccess).toBe(false);
  });

  it('invalidates verified capabilities in the first render after an in-place credential change',async()=>{
    h.auth.session={access_token:'LOCAL_OLD_CREDENTIAL'};
    const seen:{phase:string;verified:boolean;ids:string[]}[]=[];let phase='old';
    const {result,rerender}=renderHook(()=>{const value=useOperatorClubs();seen.push({phase,verified:value.scopeVerified,ids:value.operatorClubIds});return value;});
    await waitFor(()=>expect(result.current.scopeVerified).toBe(true));
    h.rpc.mockImplementation(()=>new Promise(()=>{}));
    phase='new';h.auth.session.access_token='LOCAL_NEW_CREDENTIAL';rerender();
    expect(seen.filter(row=>row.phase==='new').every(row=>!row.verified&&row.ids.length===0)).toBe(true);
    expect(result.current.clubs).toBeNull();expect(result.current.hasCashierAccess).toBe(false);
    expect(h.rpc).toHaveBeenCalledTimes(4);
  });

  it('ignores the old credential response after the new credential verifies empty scope',async()=>{
    let releaseOld!:(value:unknown)=>void;
    const oldScope=new Promise(resolve=>{releaseOld=resolve;});
    h.auth.session={access_token:'LOCAL_OLD_CREDENTIAL'};
    h.rpc.mockImplementation((name:string)=>name==='get_my_floor_operator_scope'?oldScope:Promise.resolve({data:[],error:null}));
    const {result,rerender}=renderHook(()=>useOperatorClubs());
    const oldSignals=[...h.signals];
    h.rpc.mockResolvedValue({data:[],error:null});
    h.auth.session.access_token='LOCAL_NEW_CREDENTIAL';rerender();
    await waitFor(()=>expect(result.current.scopeVerified).toBe(true));
    expect(result.current.operatorClubIds).toEqual([]);
    await act(async()=>{releaseOld({data:[{club_id:'club-old',can_owner:true,can_cashier:true,can_floor:true}],error:null});});
    expect(result.current.operatorClubIds).toEqual([]);expect(result.current.hasOwnerAccess).toBe(false);
    expect(oldSignals.every(signal=>signal.aborted)).toBe(true);
    expect(h.clubIn).not.toHaveBeenCalled();
  });
});

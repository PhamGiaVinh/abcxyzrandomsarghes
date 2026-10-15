import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useManualSwingRecovery } from "@/components/cashier/dealer-swing/useManualSwingRecovery";
import { manualSwingJournalKey, type DealerManualSwingIntent } from "@/lib/dealerManualSwingIntent";
const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const id = (n: number) => `e1800000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function context() {
  return { actorId: id(1), clubId: id(2), assignments: [{id: id(3), table_id: id(4), table_session_id: id(5), version: 1}],
    rpc: vi.fn(), onSettled: vi.fn() };
}
const key = manualSwingJournalKey({actor_user_id: id(1), club_id: id(2)});
function pending() { return JSON.parse(sessionStorage.getItem(key)!) as DealerManualSwingIntent; }
function response(intent: DealerManualSwingIntent, status = "receipt_found", result: unknown = {outcome: "swung"}) {
  return {data: {...intent,status,response:status==="receipt_found"?result:null},error:null};
}
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("persists before writing, requires canonical receipt, and prevents double-clicks", async () => {
  const ctx = context(); let finish!: (v: unknown) => void;
  ctx.rpc.mockImplementationOnce(() => { expect(pending().expected_version).toBe(1); return new Promise(resolve => {finish=resolve;}); })
    .mockImplementationOnce(() => Promise.resolve(response(pending())));
  const hook = renderHook(() => useManualSwingRecovery(ctx));
  let a!: Promise<void>; act(() => { a=hook.result.current.performSwingForTable(id(3)); void hook.result.current.performSwingForTable(id(3)); });
  expect(ctx.rpc).toHaveBeenCalledTimes(1);
  await act(async () => {finish({data:{outcome:"swung"},error:null}); await a;});
  expect(ctx.rpc.mock.calls[1][0]).toBe("get_dealer_manual_swing_receipt_v1");
  expect(sessionStorage.getItem(key)).toBeNull(); expect(ctx.onSettled).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledOnce();
});
it("reload with a disappeared assignment reconciles without another writer", async () => {
  const ctx=context(); ctx.rpc.mockResolvedValue({data:null,error:{message:"lost response"}});
  const first=renderHook(() => useManualSwingRecovery(ctx));
  await act(async () => first.result.current.performSwingForTable(id(3)));
  const intent=pending(); first.unmount(); ctx.assignments=[]; ctx.rpc.mockReset().mockResolvedValue(response(intent));
  const next=renderHook(() => useManualSwingRecovery(ctx));
  expect(next.result.current.pending).toEqual(intent); expect(ctx.rpc).not.toHaveBeenCalled();
  await act(async () => next.result.current.reconcile());
  expect(ctx.rpc).toHaveBeenCalledTimes(1); expect(ctx.rpc.mock.calls[0][0]).toBe("get_dealer_manual_swing_receipt_v1");
  expect(sessionStorage.getItem(key)).toBeNull();
});
it("retains exact request and version after unknown receipt; retry reads first", async () => {
  const ctx=context(); ctx.rpc.mockImplementation((name:string) => Promise.resolve(name==="operator_perform_swing_v2"
    ?{data:{outcome:"unexpected"},error:null}:response(pending(),"receipt_not_found")));
  const hook=renderHook(() => useManualSwingRecovery(ctx));
  await act(async () => hook.result.current.performSwingForTable(id(3)));
  const original=ctx.rpc.mock.calls[0][1]; ctx.assignments[0].version=2;
  expect(hook.result.current.retryable).toBe(true);
  await act(async () => hook.result.current.retry());
  expect(ctx.rpc.mock.calls.map(c=>c[0])).toEqual(["operator_perform_swing_v2","get_dealer_manual_swing_receipt_v1","get_dealer_manual_swing_receipt_v1","operator_perform_swing_v2","get_dealer_manual_swing_receipt_v1"]);
  expect(ctx.rpc.mock.calls[3][1]).toEqual(original); expect(pending().expected_version).toBe(1);
});
it("does not resend if the explicit retry lookup now finds the commit", async () => {
  const ctx=context(); ctx.rpc.mockResolvedValue({data:null,error:{message:"lost"}});
  const hook=renderHook(() => useManualSwingRecovery(ctx)); await act(async()=>hook.result.current.performSwingForTable(id(3)));
  ctx.rpc.mockReset().mockResolvedValue(response(pending()));
  await act(async()=>hook.result.current.retry());
  expect(ctx.rpc).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBeNull();
});
it("bounds a hung writer and ignores late success without an automatic retry", async () => {
  vi.useFakeTimers(); const ctx=context(); let finish!: (v: unknown)=>void;
  ctx.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const hook=renderHook(()=>useManualSwingRecovery(ctx)); let a!:Promise<void>;
  act(()=>{a=hook.result.current.performSwingForTable(id(3));});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);await a;});
  expect(hook.result.current.swingingTableId).toBeNull(); const intent=pending();
  await act(async()=>finish({data:{outcome:"swung"},error:null}));
  expect(toast.success).not.toHaveBeenCalled(); expect(ctx.rpc).toHaveBeenCalledTimes(1); expect(pending()).toEqual(intent);
});
it("ignores acknowledgements after unmount", async()=>{
  const ctx=context();let finish!:(v:unknown)=>void;ctx.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const hook=renderHook(()=>useManualSwingRecovery(ctx));let a!:Promise<void>;act(()=>{a=hook.result.current.performSwingForTable(id(3));});
  const intent=pending();hook.unmount();await act(async()=>{finish({data:{outcome:"swung"},error:null});await a;});
  expect(toast.success).not.toHaveBeenCalled();expect(ctx.onSettled).not.toHaveBeenCalled();expect(pending()).toEqual(intent);
});
it("old club response cannot clear the new club write flight",async()=>{
  const old=context(), next=context();next.clubId=id(22);let finishOld!:(v:unknown)=>void,finishNew!:(v:unknown)=>void;
  old.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;}));next.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finishNew=resolve;}));
  const hook=renderHook(({ctx})=>useManualSwingRecovery(ctx),{initialProps:{ctx:old}});let a!:Promise<void>,b!:Promise<void>;
  act(()=>{a=hook.result.current.performSwingForTable(id(3));});hook.rerender({ctx:next});act(()=>{b=hook.result.current.performSwingForTable(id(3));});
  await act(async()=>{finishOld({data:{outcome:"swung"},error:null});await a;});
  expect(hook.result.current.swingingTableId).toBe(id(3));expect(old.onSettled).not.toHaveBeenCalled();
  await act(async()=>{finishNew({data:null,error:{message:"unknown"}});await b;});expect(hook.result.current.swingingTableId).toBeNull();
});
it("does not send if storage silently fails to persist",async()=>{
  const ctx=context();const hook=renderHook(()=>useManualSwingRecovery(ctx));vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{});
  await act(async()=>hook.result.current.performSwingForTable(id(3)));expect(ctx.rpc).not.toHaveBeenCalled();expect(hook.result.current.error).toBeTruthy();
});
it("blocks corrupt journal rather than replacing it",async()=>{
  sessionStorage.setItem(key,"bad-json");const ctx=context();const hook=renderHook(()=>useManualSwingRecovery(ctx));
  await act(async()=>hook.result.current.performSwingForTable(id(3)));expect(ctx.rpc).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe("bad-json");
});
it("late receipt cannot delete a newer journal or claim success",async()=>{
  const ctx=context();ctx.rpc.mockResolvedValueOnce({data:null,error:{message:"lost"}});
  const hook=renderHook(()=>useManualSwingRecovery(ctx));await act(async()=>hook.result.current.performSwingForTable(id(3)));
  const old=pending(),next={...old,request_id:id(77)};let finish!:(v:unknown)=>void;ctx.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  let a!:Promise<void>;act(()=>{a=hook.result.current.reconcile();});sessionStorage.setItem(key,JSON.stringify(next));
  await act(async()=>{finish(response(old));await a;});expect(pending()).toEqual(next);expect(toast.success).not.toHaveBeenCalled();expect(ctx.onSettled).not.toHaveBeenCalled();
});
it("malformed receipt or read outage cannot unlock a retry",async()=>{
  const ctx=context();ctx.rpc.mockResolvedValueOnce({data:{outcome:"swung"},error:null}).mockImplementationOnce(()=>Promise.resolve(response({...pending(),expected_version:99})));
  const hook=renderHook(()=>useManualSwingRecovery(ctx));await act(async()=>hook.result.current.performSwingForTable(id(3)));
  expect(hook.result.current.retryable).toBe(false);expect(sessionStorage.getItem(key)).not.toBeNull();
  ctx.rpc.mockResolvedValue({data:null,error:{message:"unavailable"}});await act(async()=>hook.result.current.retry());
  expect(ctx.rpc.mock.calls.filter(c=>c[0]==="operator_perform_swing_v2")).toHaveLength(1);expect(sessionStorage.getItem(key)).not.toBeNull();
});
it("bounds receipt reads and retains the journal after late read success",async()=>{
  vi.useFakeTimers();const ctx=context();let finish!:(v:unknown)=>void;
  ctx.rpc.mockResolvedValueOnce({data:{outcome:"swung"},error:null}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const hook=renderHook(()=>useManualSwingRecovery(ctx));let a!:Promise<void>;
  act(()=>{a=hook.result.current.performSwingForTable(id(3));});
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);await a;});
  const intent=pending();expect(hook.result.current.swingingTableId).toBeNull();
  await act(async()=>finish(response(intent)));expect(pending()).toEqual(intent);expect(toast.success).not.toHaveBeenCalled();
});
it("a journal appearing after mount blocks new writes without overwriting it",async()=>{
  const ctx=context();const hook=renderHook(()=>useManualSwingRecovery(ctx));
  const newer:DealerManualSwingIntent={actor_user_id:id(1),club_id:id(2),assignment_id:id(33),table_id:id(4),table_session_id:id(5),expected_version:9,request_id:id(88)};
  sessionStorage.setItem(key,JSON.stringify(newer));
  await act(async()=>hook.result.current.performSwingForTable(id(3)));
  expect(ctx.rpc).not.toHaveBeenCalled();expect(pending()).toEqual(newer);
  act(()=>hook.result.current.reload());expect(hook.result.current.pending).toEqual(newer);
});
it("actor A-B-A lifetime cannot accept the original A response",async()=>{
  const ctx=context(), other=context();other.actorId=id(99);let finish!:(v:unknown)=>void;
  ctx.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const hook=renderHook(({value})=>useManualSwingRecovery(value),{initialProps:{value:ctx}});let a!:Promise<void>;
  act(()=>{a=hook.result.current.performSwingForTable(id(3));});const intent=pending();
  hook.rerender({value:other});hook.rerender({value:ctx});
  await act(async()=>{finish({data:{outcome:"swung"},error:null});await a;});
  expect(pending()).toEqual(intent);expect(ctx.rpc).toHaveBeenCalledTimes(1);expect(ctx.onSettled).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
});
it("explicit cancellation requires exact server tombstone before clearing",async()=>{
  const ctx=context();ctx.rpc.mockResolvedValueOnce({data:null,error:{message:"lost"}});
  const hook=renderHook(()=>useManualSwingRecovery(ctx));await act(async()=>hook.result.current.performSwingForTable(id(3)));
  const intent=pending();expect(ctx.rpc.mock.calls[0][1]).toMatchObject({p_actor_user_id:id(1),p_club_id:id(2)});
  ctx.rpc.mockReset().mockResolvedValue(response(intent,"receipt_found",{outcome:"cancelled",request_id:intent.request_id}));
  await act(async()=>hook.result.current.cancel());
  expect(ctx.rpc.mock.calls[0][0]).toBe("cancel_dealer_manual_swing_v1");expect(sessionStorage.getItem(key)).toBeNull();
  expect(toast.info).toHaveBeenCalledOnce();expect(toast.success).not.toHaveBeenCalled();
});
it("cancellation after commit reports the original result, not a fictitious undo",async()=>{
  const ctx=context();ctx.rpc.mockResolvedValueOnce({data:null,error:{message:"lost"}});
  const hook=renderHook(()=>useManualSwingRecovery(ctx));await act(async()=>hook.result.current.performSwingForTable(id(3)));
  ctx.rpc.mockReset().mockResolvedValue(response(pending()));await act(async()=>hook.result.current.cancel());
  expect(toast.success).toHaveBeenCalledOnce();expect(toast.info).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBeNull();
});
it("a hung cancellation retains its journal and ignores late cancellation success",async()=>{
  vi.useFakeTimers();const ctx=context();ctx.rpc.mockResolvedValueOnce({data:null,error:{message:"lost"}});
  const hook=renderHook(()=>useManualSwingRecovery(ctx));await act(async()=>hook.result.current.performSwingForTable(id(3)));
  const intent=pending();let finish!:(v:unknown)=>void;ctx.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  let a!:Promise<void>;act(()=>{a=hook.result.current.cancel();});await act(async()=>{await vi.advanceTimersByTimeAsync(20001);await a;});
  await act(async()=>finish(response(intent,"receipt_found",{outcome:"cancelled",request_id:intent.request_id})));
  expect(pending()).toEqual(intent);expect(toast.info).not.toHaveBeenCalled();expect(hook.result.current.swingingTableId).toBeNull();
});
it("a replaced journal prevents cancellation dispatch",async()=>{
  const ctx=context();ctx.rpc.mockResolvedValueOnce({data:null,error:{message:"lost"}});
  const hook=renderHook(()=>useManualSwingRecovery(ctx));await act(async()=>hook.result.current.performSwingForTable(id(3)));
  const newer={...pending(),request_id:id(78)};sessionStorage.setItem(key,JSON.stringify(newer));ctx.rpc.mockClear();
  await act(async()=>hook.result.current.cancel());expect(ctx.rpc).not.toHaveBeenCalled();expect(pending()).toEqual(newer);
});

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFloorAlertTransition } from "./useFloorAlertTransition";

const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>mock}));
const key='vinpoker:floor-alert-transition:v1:actor:tour';
const receipt=()=>({data:{ok:true,alert_id:'alert',status:'acknowledged',version:2,duplicate:false},error:null});
const run=(h:{result:{current:ReturnType<typeof useFloorAlertTransition>}})=>h.result.current.run('alert',1,'acknowledge',null);
beforeEach(()=>{
  localStorage.clear();mock.rpc.mockReset().mockResolvedValue(receipt());
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:unknown,_options:unknown,fn:()=>unknown)=>await fn())}});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();localStorage.clear();});

it('persists before send and blocks a second gesture until an exact receipt',async()=>{
  let finish!:(v:ReturnType<typeof receipt>)=>void;
  mock.rpc.mockImplementation(()=>{expect(localStorage.getItem(key)).not.toBeNull();return new Promise(resolve=>{finish=resolve;});});
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));let pending!:Promise<boolean>;
  act(()=>{pending=run(h);});await act(async()=>{expect(await run(h)).toBe(false);});
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  await act(async()=>{finish(receipt());expect(await pending).toBe(true);});
  expect(localStorage.getItem(key)).toBeNull();expect(h.result.current.pending).toBeNull();
});
it.each([null,{ok:true},{...receipt().data,alert_id:'other'},{...receipt().data,version:3},
  {...receipt().data,status:'resolved'},{...receipt().data,duplicate:undefined}])('retains malformed or mismatched success %j',async data=>{
  mock.rpc.mockResolvedValue({data,error:null});const h=renderHook(()=>useFloorAlertTransition('actor','tour'));
  await act(async()=>{expect(await run(h)).toBe(false);});
  expect(localStorage.getItem(key)).not.toBeNull();expect(h.result.current.blocked).toBe(true);
});
it('bounds a hung mutation, ignores its late receipt and recovers the original payload after remount',async()=>{
  vi.useFakeTimers();let finish!:(v:ReturnType<typeof receipt>)=>void;
  mock.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));let pending!:Promise<boolean>;
  act(()=>{pending=run(h);});await act(async()=>{await vi.advanceTimersByTimeAsync(20_001);expect(await pending).toBe(false);});
  const original=mock.rpc.mock.calls[0]![1],raw=localStorage.getItem(key);expect(raw).not.toBeNull();
  await act(async()=>{finish(receipt());});expect(localStorage.getItem(key)).toBe(raw);
  h.unmount();const next=renderHook(()=>useFloorAlertTransition('actor','tour'));
  mock.rpc.mockResolvedValue({data:{...receipt().data,duplicate:true},error:null});
  await act(async()=>{expect(await next.result.current.recover()).toBe(true);});
  expect(mock.rpc.mock.calls[1]![1]).toEqual(original);expect(localStorage.getItem(key)).toBeNull();
});
it('fails closed on unavailable locks or storage before any mutation',async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));
  await act(async()=>{expect(await run(h)).toBe(false);});expect(mock.rpc).not.toHaveBeenCalled();
});
it('does not send when journal persistence throws',async()=>{
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  await act(async()=>{expect(await run(h)).toBe(false);});expect(mock.rpc).not.toHaveBeenCalled();
});
it('preserves a corrupt journal without sending or deleting it',async()=>{
  localStorage.setItem(key,'invalid');const h=renderHook(()=>useFloorAlertTransition('actor','tour'));
  await act(async()=>{expect(await run(h)).toBe(false);expect(await h.result.current.recover()).toBe(false);});
  expect(mock.rpc).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('invalid');
});
it('does not adopt another actor intent or clear its journal on a late success',async()=>{
  let finish!:(v:ReturnType<typeof receipt>)=>void;mock.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const h=renderHook(({actor})=>useFloorAlertTransition(actor,'tour'),{initialProps:{actor:'actor'}});let pending!:Promise<boolean>;
  act(()=>{pending=h.result.current.run('alert',1,'acknowledge',null);});
  const raw=localStorage.getItem(key);h.rerender({actor:'other'});
  expect(h.result.current.busy).toBe(false);
  await act(async()=>{finish(receipt());expect(await pending).toBe(false);});
  expect(localStorage.getItem(key)).toBe(raw);expect(h.result.current.pending).toBeNull();
});
it('rechecks storage under the cross-tab lock and does not overwrite a different intent',async()=>{
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));
  mock.rpc.mockResolvedValueOnce({data:null,error:{message:'lost'}});
  await act(async()=>{await run(h);});const raw=localStorage.getItem(key)!;
  h.unmount();const stale=renderHook(()=>useFloorAlertTransition('actor','tour'));
  localStorage.setItem(key,JSON.stringify({...JSON.parse(raw),request:'floor-alert:'+crypto.randomUUID()}));
  await act(async()=>{expect(await stale.result.current.recover()).toBe(false);});
  expect(mock.rpc).toHaveBeenCalledTimes(1);expect(localStorage.getItem(key)).not.toBe(raw);
});
it('bounds waiting for another tab lock without scheduling a later mutation',async()=>{
  vi.useFakeTimers();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn((_key:unknown,options:{signal:AbortSignal})=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new Error('lock wait aborted')));
  }))}});
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));let pending!:Promise<boolean>;
  act(()=>{pending=run(h);});await act(async()=>{await vi.advanceTimersByTimeAsync(20_001);expect(await pending).toBe(false);});
  expect(mock.rpc).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBeNull();expect(h.result.current.busy).toBe(false);
});
it('clears a definitive canonical rejection but never an idempotency conflict',async()=>{
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));
  mock.rpc.mockResolvedValueOnce({data:{ok:false,error:'stale_alert_version'},error:null});
  await act(async()=>{expect(await run(h)).toBe(false);});expect(localStorage.getItem(key)).toBeNull();
  mock.rpc.mockResolvedValueOnce({data:{ok:false,error:'idempotency_mismatch'},error:null});
  await act(async()=>{expect(await run(h)).toBe(false);});expect(localStorage.getItem(key)).not.toBeNull();
});
it('keeps the original journal when changed permission hides an earlier receipt',async()=>{
  const h=renderHook(()=>useFloorAlertTransition('actor','tour'));
  mock.rpc.mockResolvedValueOnce({data:null,error:{message:'lost'}});
  await act(async()=>{expect(await run(h)).toBe(false);});const raw=localStorage.getItem(key);
  mock.rpc.mockResolvedValueOnce({data:{ok:false,error:'actor_not_allowed'},error:null});
  await act(async()=>{expect(await h.result.current.recover()).toBe(false);});expect(localStorage.getItem(key)).toBe(raw);
  mock.rpc.mockResolvedValueOnce({data:{...receipt().data,duplicate:true},error:null});
  await act(async()=>{expect(await h.result.current.recover()).toBe(true);});expect(localStorage.getItem(key)).toBeNull();
  expect(mock.rpc.mock.calls[2]![1]).toEqual(mock.rpc.mock.calls[0]![1]);
});

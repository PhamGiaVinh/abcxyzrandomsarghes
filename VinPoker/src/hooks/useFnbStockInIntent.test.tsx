import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),read:vi.fn(),settled:vi.fn(),signals:[] as AbortSignal[]}));
const builder=(promise:Promise<{data:unknown;error:unknown}>)=>Object.assign(promise,{abortSignal:(s:AbortSignal)=>{h.signals.push(s);return promise;}});
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>builder(h.rpc(...args)),from:()=>{
  const b={select:()=>b,eq:()=>b,limit:()=>b,abortSignal:(s:AbortSignal)=>{h.signals.push(s);return h.read();}};return b;
}}}));
import {useFnbStockInIntent} from './useFnbStockInIntent';
import {persistFnbStockInIntent,readFnbStockInJournal} from '@/lib/fnbStockInIntent';
const actor='10000000-0000-4000-8000-000000000001',club='20000000-0000-4000-8000-000000000001',key='30000000-0000-4000-8000-000000000001';
const backend='http://127.0.0.1:54329',payload={ingredient_id:'40000000-0000-4000-8000-000000000001',qty_purchase:0.5,unit_cost_purchase:1000};
const intent={actorId:actor,clubId:club,backend,requestId:key,payload};
const found=()=>[{id:'50000000-0000-4000-8000-000000000001',actor,club_id:club,client_request_id:key,
  ingredient_id:payload.ingredient_id,reason:'stock_in',ref_type:'manual',delta:0.5,unit_cost:1000,balance_after:14.5,
  details:{stock_in_intent_v1:{version:1,club_id:club,...payload}}}];
beforeEach(()=>{
  localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL',backend);h.signals=[];
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:string,work:()=>unknown)=>work())}});
  h.rpc.mockReset().mockResolvedValue({data:null,error:{message:'503'}});
  h.read.mockReset().mockResolvedValue({data:null,error:{message:'503'}});h.settled.mockReset().mockResolvedValue(undefined);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();});
it('retains unknown writes across remount and only explicit receipt recovery settles them',async()=>{
  const first=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));await act(async()=>{await first.result.current.submit(key,payload);});
  expect(h.rpc).toHaveBeenCalledTimes(1);expect(first.result.current.pending).toEqual(intent);first.unmount();h.rpc.mockClear();h.read.mockClear();
  const next=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));await waitFor(()=>expect(next.result.current.pending).toEqual(intent));
  expect(h.rpc).not.toHaveBeenCalled();expect(h.read).not.toHaveBeenCalled();
  h.read.mockResolvedValue({data:found(),error:null});await act(async()=>{await next.result.current.recover();});
  expect(h.rpc).not.toHaveBeenCalled();expect(h.settled).toHaveBeenCalledOnce();expect(next.result.current.pending).toBeNull();
  expect(readFnbStockInJournal(localStorage,actor,club,backend)?.state).toBe('settled');
});
it('reads before an explicit retry and sends the original request and fractional payload only when absent',async()=>{
  persistFnbStockInIntent(localStorage,intent);const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));
  h.read.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:found(),error:null});
  await act(async()=>{await v.result.current.retry();});expect(h.rpc).toHaveBeenCalledWith('fnb_stock_in',{
    p_club_id:club,p_ingredient_id:payload.ingredient_id,p_qty_purchase:0.5,p_unit_cost_purchase:1000,p_client_request_id:key});
  expect(h.rpc).toHaveBeenCalledOnce();expect(h.read).toHaveBeenCalledTimes(2);expect(h.settled).toHaveBeenCalledOnce();
});
it('does not treat a bare successful acknowledgement or an absent receipt as settled',async()=>{
  h.rpc.mockResolvedValue({data:{status:'ok',idempotent:true},error:null});h.read.mockResolvedValue({data:[],error:null});
  const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));await act(async()=>{await v.result.current.submit(key,payload);});
  await act(async()=>{await v.result.current.recover();});
  expect(h.rpc).toHaveBeenCalledOnce();expect(h.settled).not.toHaveBeenCalled();expect(v.result.current.pending).toEqual(intent);
  expect(v.result.current.message).toContain('Chưa tìm thấy receipt');
});
it('persists before network and refuses a silent storage failure',async()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));
  await act(async()=>{await v.result.current.submit(key,payload);});expect(h.rpc).not.toHaveBeenCalled();expect(h.read).not.toHaveBeenCalled();
});
it('does not dispatch a second click while the first writer is unresolved',async()=>{
  let finish!:(v:{data:unknown;error:unknown})=>void;h.rpc.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));let first:unknown;
  act(()=>{first=v.result.current.submit(key,payload);});await waitFor(()=>expect(h.rpc).toHaveBeenCalledOnce());
  await act(async()=>{await v.result.current.submit('30000000-0000-4000-8000-000000000002',payload);});
  expect(h.rpc).toHaveBeenCalledOnce();await act(async()=>{finish({data:null,error:{message:'503'}});await first;});
  expect(v.result.current.pending?.requestId).toBe(key);
});
it('ignores late completion after unmount and aborts its owned transport',async()=>{
  let finish!:(v:{data:unknown;error:unknown})=>void;h.rpc.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));let work:unknown;
  act(()=>{work=v.result.current.submit(key,payload);});await waitFor(()=>expect(h.rpc).toHaveBeenCalledOnce());v.unmount();
  expect(h.signals[0].aborted).toBe(true);await act(async()=>{finish({data:{status:'ok'},error:null});await work;});
  expect(h.read).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();
});
it('keeps a mismatched or legacy receipt unresolved and does not retry its writer',async()=>{
  persistFnbStockInIntent(localStorage,intent);h.read.mockResolvedValue({data:[{...found()[0],details:{}}],error:null});
  const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));await act(async()=>{await v.result.current.retry();});
  expect(h.rpc).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();expect(v.result.current.pending).toEqual(intent);
  expect(v.result.current.readOnlyRecovery).toBe(true);expect(v.result.current.message).toContain('thiếu nội dung yêu cầu gốc');
  const reads=h.read.mock.calls.length;h.read.mockResolvedValue({data:[],error:null});
  await act(async()=>{await v.result.current.retry();});expect(h.read).toHaveBeenCalledTimes(reads);expect(h.rpc).not.toHaveBeenCalled();
  h.read.mockResolvedValue({data:found(),error:null});await act(async()=>{await v.result.current.recover();});
  expect(v.result.current.pending).toBeNull();expect(v.result.current.readOnlyRecovery).toBe(false);expect(h.settled).toHaveBeenCalledOnce();expect(h.rpc).not.toHaveBeenCalled();
});
it('can read an old receipt after another tab changes the journal without clearing or notifying for the newer request',async()=>{
  persistFnbStockInIntent(localStorage,intent);const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));
  persistFnbStockInIntent(localStorage,intent,true);const next={...intent,requestId:'30000000-0000-4000-8000-000000000002'};
  persistFnbStockInIntent(localStorage,next);act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null})));
  expect(v.result.current.readOnlyRecovery).toBe(true);h.read.mockResolvedValue({data:found(),error:null});
  await act(async()=>{await v.result.current.recover();});expect(h.settled).not.toHaveBeenCalled();expect(h.rpc).not.toHaveBeenCalled();
  expect(v.result.current.pending).toEqual(next);expect(readFnbStockInJournal(localStorage,actor,club,backend)?.intent).toEqual(next);
});

it('bounds a lost writer response and resolves its committed receipt with one read and no replay',async()=>{
 vi.useFakeTimers();h.rpc.mockImplementationOnce(()=>new Promise(()=>{}));h.read.mockResolvedValue({data:found(),error:null});
 const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));let work:unknown;
 act(()=>{work=v.result.current.submit(key,payload);});await act(async()=>{await vi.advanceTimersByTimeAsync(20001);await work;});
 expect(h.rpc).toHaveBeenCalledOnce();expect(h.read).toHaveBeenCalledOnce();expect(h.settled).toHaveBeenCalledOnce();
 expect(v.result.current.pending).toBeNull();expect(v.result.current.busy).toBe(false);expect(h.signals.every(s=>s.aborted)).toBe(true);
});
it('bounds a hanging receipt read, keeps the original request and aborts the read transport',async()=>{
 vi.useFakeTimers();persistFnbStockInIntent(localStorage,intent);h.read.mockImplementationOnce(()=>new Promise(()=>{}));
 const v=renderHook(()=>useFnbStockInIntent(actor,club,h.settled));let work:unknown;
 act(()=>{work=v.result.current.recover();});await act(async()=>{await vi.advanceTimersByTimeAsync(10001);await work;});
 expect(h.rpc).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();expect(v.result.current.pending).toEqual(intent);
 expect(v.result.current.busy).toBe(false);expect(h.signals[0].aborted).toBe(true);
});

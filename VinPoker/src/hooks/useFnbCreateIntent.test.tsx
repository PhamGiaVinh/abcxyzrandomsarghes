import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),settled:vi.fn(),cancelled:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('sonner',()=>({toast:{error:h.error}}));
import {useFnbCreateIntent} from './useFnbCreateIntent';
import {persistFnbCreateIntent} from '@/lib/fnbCreateIntent';
const actor='10000000-0000-4000-8000-000000000001',club='20000000-0000-4000-8000-000000000001',key='30000000-0000-4000-8000-000000000001';
const payload={source:'counter' as const,table:null,customer:'TEST name',note:null,lines:[{menu_item_id:'40000000-0000-4000-8000-000000000001',qty:1}],table_ref:null,player_ref:null};
const found=(p=payload,operation='order')=>({status:'found',actor_id:actor,club_id:club,request_id:key,operation,intent:p,
 order:{id:'50000000-0000-4000-8000-000000000001',status:operation==='comp'?'paid':'pending',subtotal_vnd:5000,is_comp:operation==='comp'}});
describe('durable create write/recovery boundary',()=>{
 it('keeps its frozen intent when another tab settles; reads proof without overwriting a newer intent',async()=>{
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled,h.cancelled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});
  const original=view.result.current.pending!;
  persistFnbCreateIntent(localStorage,original,true);
  act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null})));
  expect(view.result.current.pending?.requestId).toBe(key);
  expect(view.result.current.readOnlyRecovery).toBe(true);
  const newer={...original,requestId:'30000000-0000-4000-8000-000000000002'};
  persistFnbCreateIntent(localStorage,newer);
  act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null})));
  h.rpc.mockClear();h.rpc.mockResolvedValue({data:found(),error:null});
  await act(async()=>{await view.result.current.recover();});
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['fnb_get_create_receipt_v1']);
  expect(view.result.current.pending?.requestId).toBe(newer.requestId);
  expect(h.settled.mock.calls[0][0].requestId).toBe(key);
 });
 beforeEach(()=>{
  localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async (_name:string,work:()=>unknown)=>work())}});
  h.rpc.mockReset().mockResolvedValue({data:null,error:{message:'503'}});h.settled.mockReset().mockResolvedValue(undefined);h.cancelled.mockReset();h.error.mockReset();
 });
 afterEach(()=>vi.restoreAllMocks());
 it.each(['order','comp'] as const)('retains %s request and payload over unmount without automatic retry',async operation=>{
  const p=operation==='order'?payload:{source:payload.source,table:null,customer:'TEST name',note:null,lines:payload.lines,reason:'original reason'};
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  await act(async()=>{await view.result.current.submit(operation,key,p);});
  expect(view.result.current.pending).toMatchObject({requestId:key,operation,payload:p});view.unmount();h.rpc.mockClear();
  const next=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  await waitFor(()=>expect(next.result.current.pending?.requestId).toBe(key));
  expect(h.rpc).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();
  await act(async()=>{await next.result.current.submit('order','30000000-0000-4000-8000-000000000002',payload);});
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('checks receipt before explicit retry, preserving exact key and payload',async()=>{
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});
  const original=h.rpc.mock.calls.find(([name])=>name==='fnb_create_order')![1];
  let reads=0;h.rpc.mockImplementation((name:string)=>Promise.resolve(name==='fnb_get_create_receipt_v1'
   ?{data:++reads===1?{status:'not_found',actor_id:actor,club_id:club,request_id:key}:found(),error:null}
   :{data:{status:'ok',idempotent:true,order_id:found().order.id},error:null}));
  await act(async()=>{await view.result.current.retry();});
  const writes=h.rpc.mock.calls.filter(([name])=>name==='fnb_create_order');expect(writes).toHaveLength(2);expect(writes[1][1]).toEqual(original);
  expect(h.settled).toHaveBeenCalledTimes(1);expect(view.result.current.pending).toBeNull();
 });
 it('not_found lookup alone never settles or creates another request',async()=>{
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});h.rpc.mockClear();
  h.rpc.mockResolvedValue({data:{status:'not_found',actor_id:actor,club_id:club,request_id:key},error:null});
  await act(async()=>{await view.result.current.recover();});
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['fnb_get_create_receipt_v1']);expect(h.settled).not.toHaveBeenCalled();expect(view.result.current.pending?.requestId).toBe(key);
 });
 it('a bare successful write cannot clear the journal without a matching receipt',async()=>{
  h.rpc.mockResolvedValue({data:{status:'ok',order_id:found().order.id,idempotent:false,subtotal_vnd:5000},error:null});
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});
  expect(h.settled).not.toHaveBeenCalled();expect(view.result.current.pending?.requestId).toBe(key);
 });
 it('requires persisted storage before any network write',async()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});
  expect(h.rpc).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();
 });
 it('ignores old incarnation completion after unmount',async()=>{
  let finish!:(value:unknown)=>void;h.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));let work:unknown;
  act(()=>{work=view.result.current.submit('order',key,payload);});await waitFor(()=>expect(h.rpc).toHaveBeenCalled());view.unmount();
  await act(async()=>{finish({data:{status:'ok'},error:null});await work;});
  expect(h.settled).not.toHaveBeenCalled();expect(h.error).not.toHaveBeenCalled();
 });
 it('synchronous double submit dispatches only once',async()=>{
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  await act(async()=>{await Promise.all([view.result.current.submit('order',key,payload),view.result.current.submit('order',key,payload)]);});
  expect(h.rpc.mock.calls.filter(([name])=>name==='fnb_create_order')).toHaveLength(1);
 });
 it('blocks writes when origin locking is unavailable',async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled));
  expect(view.result.current.blocked).toBe(true);
  await act(async()=>{await view.result.current.submit('order',key,payload);});expect(h.rpc).not.toHaveBeenCalled();
 });
 it.each(['order','comp'] as const)('settles %s only after an exact cancellation fence, without another create',async operation=>{
  const p=operation==='order'?payload:{source:payload.source,table:null,customer:'TEST name',note:null,lines:payload.lines,reason:'original reason'};
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled,h.cancelled));
  await act(async()=>{await view.result.current.submit(operation,key,p);});h.rpc.mockClear();
  h.rpc.mockResolvedValue({data:{status:'cancelled',actor_id:actor,club_id:club,request_id:key,operation,intent:p},error:null});
  await act(async()=>{await view.result.current.cancel();});
  expect(h.rpc.mock.calls).toEqual([['fnb_cancel_create_intent_v1',{p_club_id:club,p_request_id:key,p_expected_actor:actor,p_operation:operation,p_payload:p}]]);
  expect(h.cancelled).toHaveBeenCalledTimes(1);expect(h.settled).not.toHaveBeenCalled();expect(view.result.current.pending).toBeNull();
 });
 it('cancel after commit recovers the order instead of reporting cancellation',async()=>{
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled,h.cancelled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});h.rpc.mockClear();
  h.rpc.mockResolvedValue({data:found(),error:null});await act(async()=>{await view.result.current.cancel();});
  expect(h.settled).toHaveBeenCalledTimes(1);expect(h.cancelled).not.toHaveBeenCalled();expect(view.result.current.pending).toBeNull();
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['fnb_cancel_create_intent_v1']);
 });
 it('unknown cancel plus not_found never clears the intent or writes a new order',async()=>{
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled,h.cancelled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});h.rpc.mockClear();
  h.rpc.mockImplementation((name:string)=>Promise.resolve(name==='fnb_cancel_create_intent_v1'?{data:null,error:{message:'503'}}:
   {data:{status:'not_found',actor_id:actor,club_id:club,request_id:key},error:null}));
  await act(async()=>{await view.result.current.cancel();});
  expect(view.result.current.pending?.requestId).toBe(key);expect(h.cancelled).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['fnb_cancel_create_intent_v1','fnb_get_create_receipt_v1']);
 });
 it('lost cancel response can settle through the retained full read receipt',async()=>{
  const view=renderHook(()=>useFnbCreateIntent(actor,club,h.settled,h.cancelled));
  await act(async()=>{await view.result.current.submit('order',key,payload);});h.rpc.mockClear();
  h.rpc.mockImplementation((name:string)=>Promise.resolve(name==='fnb_cancel_create_intent_v1'?{data:null,error:{message:'503'}}:
   {data:{status:'cancelled',actor_id:actor,club_id:club,request_id:key,operation:'order',intent:payload},error:null}));
  await act(async()=>{await view.result.current.cancel();});
  expect(h.cancelled).toHaveBeenCalledTimes(1);expect(view.result.current.pending).toBeNull();
 });
});

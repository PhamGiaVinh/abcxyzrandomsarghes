import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {OpsClient} from '@/ops/opsMutations';
import {tournamentEditJournalKey,type TournamentEditRequest} from '@/lib/tournamentEdit';
import {useOpsTournamentEdit,type OpsEditPatch} from './useOpsTournamentEdit';
const actor='e2010000-0000-4000-8000-000000000001',club='e2010000-0000-4000-8000-000000000002',tour='e2010000-0000-4000-8000-000000000003';
const config={name:'Existing TEST',start_time:'2026-10-19T17:32:41.520568+07:00',buy_in:100000,rake_amount:10000,service_fee_amount:5000,guarantee_amount:null,starting_stack:20000,location:'TEST room',description:'Preserve',game_type:'nlh',minutes_per_level:20,late_reg_close_level:6};
const state={config,levels:[],lifecycle:{club_id:club,status:'live',live_status:'playing'}};
const patch:OpsEditPatch={name:'Renamed TEST',startTime:config.start_time,buyIn:101000,startingStack:21000,minutesPerLevel:20,lateRegCloseLevel:6};
const key=tournamentEditJournalKey(actor,club,tour);
type Reply={data:unknown;error:unknown};
function fixture(){
 const signals:AbortSignal[]=[],onSaved=vi.fn();
 const base=(name:string,args:Record<string,unknown>):Reply=>name==='get_tournament_edit_context_v1'
  ?{data:{ok:true,tournament_id:tour,club_id:club,actor_id:actor,can_edit_blinds:true,state},error:null}
  :{data:{ok:true,tournament_id:tour,club_id:club,actor_id:actor,request_id:args.p_request_id,state:{...state,config:args.p_config}},error:null};
 const env={base,handler:base as (name:string,args:Record<string,unknown>)=>Reply|Promise<Reply>};
 const rpc=vi.fn((name:string,args:Record<string,unknown>)=>{const promise=Promise.resolve(env.handler(name,args));return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{signals.push(signal);return promise;}});});
 const options={open:true,client:{rpc} as unknown as OpsClient,actorId:actor,epoch:1,clubId:club,tourId:tour,onSaved};
 return {...env,env,rpc,signals,onSaved,options};
}
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it('loads verified context, persists before writing and preserves hidden config and exact timestamp',async()=>{
 const f=fixture();f.env.handler=(name,args)=>{if(name==='edit_tournament_with_levels_v1'){expect(JSON.parse(localStorage.getItem(key)!)).toEqual(args);expect(args.p_levels).toBeNull();expect(args.p_config).toMatchObject({rake_amount:10000,service_fee_amount:5000,guarantee_amount:null,location:'TEST room',start_time:config.start_time});}return f.base(name,args);};
 const view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.ready).toBe(true));
 await act(async()=>{await view.result.current.save(patch);});
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['get_tournament_edit_context_v1','edit_tournament_with_levels_v1']);expect(f.onSaved).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).toBeNull();
});
it('reconciles a lost response with the same request and no extra writer',async()=>{
 const f=fixture();f.env.handler=(name,args)=>name==='edit_tournament_with_levels_v1'?{data:null,error:{message:'lost'}}:f.base(name,args);
 const view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.ready).toBe(true));await act(async()=>{await view.result.current.save(patch);});
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['get_tournament_edit_context_v1','edit_tournament_with_levels_v1','get_tournament_edit_receipt_v1']);expect(f.rpc.mock.calls[1][1]).toEqual(f.rpc.mock.calls[2][1]);expect(f.onSaved).toHaveBeenCalledOnce();
});
it('retains unknown outcome, checks read-only on Save, and retries only the exact original request explicitly',async()=>{
 const f=fixture();let accept=false;f.env.handler=(name,args)=>name==='get_tournament_edit_context_v1'||accept?f.base(name,args):{data:{ok:false,error:'receipt_not_found'},error:null};
 const view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.ready).toBe(true));await act(async()=>{await view.result.current.save(patch);});
 const original=JSON.parse(localStorage.getItem(key)!);expect(view.result.current.pending).not.toBeNull();expect(f.onSaved).not.toHaveBeenCalled();
 await act(async()=>{await view.result.current.save({...patch,name:'Ignored new name',buyIn:1});});expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);
 accept=true;await act(async()=>{await view.result.current.save(undefined,true);});
 for(const [,args] of f.rpc.mock.calls.filter(c=>c[0]!=='get_tournament_edit_context_v1'))expect(args).toEqual(original);expect(f.onSaved).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).toBeNull();
});
it('restores pending payload on remount without replacing its expected state with a fresh read',async()=>{
 const f=fixture();f.env.handler=(name,args)=>name==='get_tournament_edit_context_v1'?f.base(name,args):{data:null,error:{message:'offline'}};
 const first=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(first.result.current.ready).toBe(true));await act(async()=>{await first.result.current.save(patch);});const raw=localStorage.getItem(key);first.unmount();
 f.env.handler=f.base;const second=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(second.result.current.pending).not.toBeNull());expect(second.result.current.config?.name).toBe(patch.name);expect(localStorage.getItem(key)).toBe(raw);
 await act(async()=>{await second.result.current.save();});expect(f.rpc.mock.calls.filter(c=>c[0]==='get_tournament_edit_context_v1')).toHaveLength(1);expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);expect(f.onSaved).toHaveBeenCalledOnce();
});
it('requires a fresh context after a definitive stale-state rejection and never reports success',async()=>{
 const f=fixture();f.env.handler=(name,args)=>name==='edit_tournament_with_levels_v1'?{data:{ok:false,error:'stale_edit_context'},error:null}:f.base(name,args);
 const view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.ready).toBe(true));await act(async()=>{await view.result.current.save(patch);});expect(view.result.current.ready).toBe(false);expect(localStorage.getItem(key)).toBeNull();expect(f.onSaved).not.toHaveBeenCalled();
 act(()=>view.result.current.reload());await waitFor(()=>expect(view.result.current.ready).toBe(true));expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);
});
it('does not dispatch a writer if the journal cannot be retained',async()=>{
 const f=fixture(),view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.ready).toBe(true));vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage unavailable');});await act(async()=>{await view.result.current.save(patch);});expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['get_tournament_edit_context_v1']);expect(f.onSaved).not.toHaveBeenCalled();
});
it('blocks double click and retains a late successful write for receipt recovery after unmount',async()=>{
 const f=fixture();let resolve!:(value:Reply)=>void;let request:Record<string,unknown>={};f.env.handler=(name,args)=>{if(name==='edit_tournament_with_levels_v1'){request=args;return new Promise(r=>{resolve=r;});}return f.base(name,args);};
 const view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.ready).toBe(true));let saving!:Promise<void>;act(()=>{saving=view.result.current.save(patch);void view.result.current.save(patch);});expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);view.unmount();await act(async()=>{resolve(f.base('edit_tournament_with_levels_v1',request));await saving;});expect(f.onSaved).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();
});
it('bounds context loading and aborts the SDK read',async()=>{
 vi.useFakeTimers();const f=fixture();f.env.handler=()=>new Promise(()=>{});const view=renderHook(()=>useOpsTournamentEdit(f.options));await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});expect(view.result.current.loading).toBe(false);expect(view.result.current.ready).toBe(false);expect(f.signals[0].aborted).toBe(true);expect(f.onSaved).not.toHaveBeenCalled();
});
it('blocks a malformed retained journal rather than creating another request',async()=>{
 localStorage.setItem(key,'broken');const f=fixture(),view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.error).toBeTruthy());await act(async()=>{await view.result.current.save(patch);});expect(f.rpc).not.toHaveBeenCalled();expect(f.onSaved).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('broken');
});
it('does not accept a late read from a previous epoch after A to B to A',async()=>{
 const f=fixture();let oldResolve!:(value:Reply)=>void;let reads=0;
 f.env.handler=(name,args)=>{if(name==='get_tournament_edit_context_v1'&&++reads===1)return new Promise(r=>{oldResolve=r;});return f.base(name,args);};
 const view=renderHook(({epoch})=>useOpsTournamentEdit({...f.options,epoch}),{initialProps:{epoch:1}});
 view.rerender({epoch:2});await waitFor(()=>expect(view.result.current.ready).toBe(true));
 view.rerender({epoch:1});await waitFor(()=>expect(reads).toBe(3));await waitFor(()=>expect(view.result.current.ready).toBe(true));
 await act(async()=>{oldResolve({data:{ok:true,tournament_id:tour,club_id:club,actor_id:actor,can_edit_blinds:true,state:{...state,config:{...config,name:'Obsolete read'}}},error:null});});
 expect(view.result.current.config?.name).toBe(config.name);expect(f.onSaved).not.toHaveBeenCalled();expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(0);
});
it('retains an old epoch write for recovery without closing a new scope',async()=>{
 const f=fixture();let resolve!:(value:Reply)=>void;let request:Record<string,unknown>={};
 f.env.handler=(name,args)=>{if(name==='edit_tournament_with_levels_v1'){request=args;return new Promise(r=>{resolve=r;});}return f.base(name,args);};
 const view=renderHook(({epoch})=>useOpsTournamentEdit({...f.options,epoch}),{initialProps:{epoch:1}});await waitFor(()=>expect(view.result.current.ready).toBe(true));let saving!:Promise<void>;
 act(()=>{saving=view.result.current.save(patch);});view.rerender({epoch:2});await waitFor(()=>expect(view.result.current.pending).not.toBeNull());
 await act(async()=>{resolve(f.base('edit_tournament_with_levels_v1',request));await saving;});expect(f.onSaved).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();expect(view.result.current.pending?.p_request_id).toBe(request.p_request_id);
});
it('does not retry a writer after its receipt read outlives the open form',async()=>{
 const f=fixture();f.env.handler=(name,args)=>name==='get_tournament_edit_context_v1'?f.base(name,args):{data:null,error:{message:'offline'}};
 const view=renderHook(({open})=>useOpsTournamentEdit({...f.options,open}),{initialProps:{open:true}});await waitFor(()=>expect(view.result.current.ready).toBe(true));await act(async()=>{await view.result.current.save(patch);});
 const retained=localStorage.getItem(key);let rejectReceipt!:(value:Reply)=>void;f.env.handler=(name,args)=>name==='get_tournament_edit_receipt_v1'?new Promise(r=>{rejectReceipt=r;}):f.base(name,args);
 let retry!:Promise<void>;act(()=>{retry=view.result.current.save(undefined,true);});view.rerender({open:false});
 await act(async()=>{rejectReceipt({data:null,error:{message:'late read failure'}});await retry;});
 expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);expect(localStorage.getItem(key)).toBe(retained);expect(f.onSaved).not.toHaveBeenCalled();
});
it('rechecks the retained request after a delayed receipt before explicit original retry',async()=>{
 const f=fixture();f.env.handler=(name,args)=>name==='get_tournament_edit_context_v1'?f.base(name,args):{data:null,error:{message:'offline'}};
 const view=renderHook(()=>useOpsTournamentEdit(f.options));await waitFor(()=>expect(view.result.current.ready).toBe(true));await act(async()=>{await view.result.current.save(patch);});
 let rejectReceipt!:(value:Reply)=>void;f.env.handler=(name,args)=>name==='get_tournament_edit_receipt_v1'?new Promise(r=>{rejectReceipt=r;}):f.base(name,args);
 let retry!:Promise<void>;act(()=>{retry=view.result.current.save(undefined,true);});const changed=JSON.stringify({...JSON.parse(localStorage.getItem(key)!),p_request_id:'e2010000-0000-4000-8000-000000000099'});localStorage.setItem(key,changed);
 await act(async()=>{rejectReceipt({data:null,error:{message:'late read failure'}});await retry;});
 expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);expect(localStorage.getItem(key)).toBe(changed);expect(f.onSaved).not.toHaveBeenCalled();
});
it('does not dispatch a delayed retry across a session epoch round trip',async()=>{
 const f=fixture();f.env.handler=(name,args)=>name==='get_tournament_edit_context_v1'?f.base(name,args):{data:null,error:{message:'offline'}};
 const view=renderHook(({epoch})=>useOpsTournamentEdit({...f.options,epoch}),{initialProps:{epoch:1}});await waitFor(()=>expect(view.result.current.ready).toBe(true));await act(async()=>{await view.result.current.save(patch);});
 const retained=localStorage.getItem(key);let rejectReceipt!:(value:Reply)=>void;f.env.handler=(name,args)=>name==='get_tournament_edit_receipt_v1'?new Promise(r=>{rejectReceipt=r;}):f.base(name,args);
 let retry!:Promise<void>;act(()=>{retry=view.result.current.save(undefined,true);});view.rerender({epoch:2});await waitFor(()=>expect(view.result.current.pending).not.toBeNull());view.rerender({epoch:1});await waitFor(()=>expect(view.result.current.pending).not.toBeNull());
 await act(async()=>{rejectReceipt({data:null,error:{message:'late read failure'}});await retry;});
 expect(f.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);expect(localStorage.getItem(key)).toBe(retained);expect(f.onSaved).not.toHaveBeenCalled();
});

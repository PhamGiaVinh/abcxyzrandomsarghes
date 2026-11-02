import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {OpsClient} from '@/ops/opsMutations';
import {tournamentCreateJournalKey,type TournamentCreateRequest} from '@/lib/tournamentCreate';
import {useOpsTournamentCreate} from './useOpsTournamentCreate';
const actor='e2010000-0000-4000-8000-000000000001',club='e2010000-0000-4000-8000-000000000002',key=tournamentCreateJournalKey(actor,club);
const patch={name:'Create controller TEST',startTime:'2030-01-02T13:00:00.000Z',buyIn:100000,startingStack:20000,minutesPerLevel:20,lateRegCloseLevel:6};
const pending:TournamentCreateRequest={p_club_id:club,p_expected_actor_id:actor,p_request_id:'e2010000-0000-4000-8000-000000000004',p_levels:[],p_config:{name:patch.name,start_time:patch.startTime,buy_in:100000,rake_amount:0,service_fee_amount:0,starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6,status:'upcoming',current_level:1}};
const ack=(request:TournamentCreateRequest)=>({data:{ok:true,tournament_id:'e2010000-0000-4000-8000-000000000003',club_id:club,actor_id:actor,request_id:request.p_request_id,level_count:request.p_levels.length},error:null});
const rpc=vi.fn(),done=vi.fn(),client={rpc} as unknown as OpsClient;
const options={open:true,actorId:actor,clubId:club,epoch:1,client,onCreated:done};
async function mount(){const view=renderHook(props=>useOpsTournamentCreate(props),{initialProps:options});await waitFor(()=>expect(view.result.current.ready).toBe(true));return view;}
beforeEach(()=>{localStorage.clear();rpc.mockReset();done.mockReset();});afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('retains an unresolved successful request when the form closes before the reply',async()=>{
 let resolve!:(value:unknown)=>void;let request!:TournamentCreateRequest;rpc.mockImplementation((_,args)=>{request=args;return new Promise(r=>{resolve=r;});});const view=await mount();let operation!:Promise<void>;act(()=>{operation=view.result.current.save(patch);});view.rerender({...options,open:false});await act(async()=>{resolve(ack(request));await operation;});expect(done).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(request);
});
it('does not explicitly retry a pending writer after closing during a delayed receipt failure',async()=>{
 localStorage.setItem(key,JSON.stringify(pending));let resolve!:(value:unknown)=>void;rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=await mount();let operation!:Promise<void>;act(()=>{operation=view.result.current.save(undefined,true);});view.rerender({...options,open:false});await act(async()=>{resolve({data:null,error:{message:'receipt lost'}});await operation;});expect(rpc.mock.calls.map(x=>x[0])).toEqual(['get_tournament_create_receipt_v1']);expect(JSON.parse(localStorage.getItem(key)!)).toEqual(pending);expect(done).not.toHaveBeenCalled();
});
it('rechecks the exact journal after a delayed receipt failure before explicit retry',async()=>{
 localStorage.setItem(key,JSON.stringify(pending));let resolve!:(value:unknown)=>void;rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=await mount();let operation!:Promise<void>;act(()=>{operation=view.result.current.save(undefined,true);});const next={...pending,p_request_id:'e2010000-0000-4000-8000-000000000005'};localStorage.setItem(key,JSON.stringify(next));await act(async()=>{resolve({data:null,error:{message:'receipt lost'}});await operation;});expect(rpc.mock.calls.map(x=>x[0])).toEqual(['get_tournament_create_receipt_v1']);expect(JSON.parse(localStorage.getItem(key)!)).toEqual(next);expect(done).not.toHaveBeenCalled();
});
it('does not clear a newer journal when an older create reply succeeds',async()=>{
 let resolve!:(value:unknown)=>void;let request!:TournamentCreateRequest;rpc.mockImplementation((_,args)=>{request=args;return new Promise(r=>{resolve=r;});});const view=await mount();let operation!:Promise<void>;act(()=>{operation=view.result.current.save(patch);});const next={...pending,p_request_id:'e2010000-0000-4000-8000-000000000005'};localStorage.setItem(key,JSON.stringify(next));await act(async()=>{resolve(ack(request));await operation;});expect(JSON.parse(localStorage.getItem(key)!)).toEqual(next);expect(done).not.toHaveBeenCalled();
});
it('fences an A-to-B-to-A session lifetime and permits later receipt recovery of its retained request',async()=>{
 let resolve!:(value:unknown)=>void;let request!:TournamentCreateRequest;rpc.mockImplementation((_,args)=>{request=args;return new Promise(r=>{resolve=r;});});const view=await mount();let operation!:Promise<void>;act(()=>{operation=view.result.current.save(patch);});view.rerender({...options,epoch:2});view.rerender(options);await act(async()=>{resolve(ack(request));await operation;});expect(done).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(request);rpc.mockImplementation((name,args)=>{expect(name).toBe('get_tournament_create_receipt_v1');return Promise.resolve(ack(args));});await waitFor(()=>expect(view.result.current.ready).toBe(true));await act(async()=>view.result.current.save());expect(done).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).toBeNull();
});
it('keeps an unknown structured rejection rather than granting permission for a new request',async()=>{
 rpc.mockResolvedValue({data:{ok:false,error:'future_backend_state'},error:null});const view=await mount();await act(async()=>view.result.current.save(patch));expect(localStorage.getItem(key)).not.toBeNull();expect(view.result.current.pending).not.toBeNull();expect(done).not.toHaveBeenCalled();
});
it('permits correction only after a known pre-insert input rejection',async()=>{
 rpc.mockResolvedValue({data:{ok:false,error:'invalid_create_money'},error:null});const view=await mount();await act(async()=>view.result.current.save(patch));expect(localStorage.getItem(key)).toBeNull();expect(view.result.current.pending).toBeNull();expect(view.result.current.error).toContain('Máy chủ chưa chấp nhận');expect(done).not.toHaveBeenCalled();
});
it('preserves malformed storage and blocks a new writer until its read is resolved',async()=>{
 localStorage.setItem(key,'{broken');const view=renderHook(()=>useOpsTournamentCreate(options));await waitFor(()=>expect(view.result.current.error).toContain('Không đọc được'));expect(view.result.current.ready).toBe(false);await act(async()=>view.result.current.save(patch));expect(rpc).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('{broken');
});
it('recovers by receipt after journal removal fails following an authoritative create success',async()=>{
 rpc.mockImplementation((_,args)=>Promise.resolve(ack(args)));const view=await mount();const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('blocked');});await act(async()=>view.result.current.save(patch));expect(done).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();remove.mockRestore();rpc.mockImplementation((name,args)=>{expect(name).toBe('get_tournament_create_receipt_v1');return Promise.resolve(ack(args));});await act(async()=>view.result.current.save());expect(done).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).toBeNull();
});
it('keeps the old journal when receipt is unavailable and an explicit retry receives a pre-insert rejection',async()=>{
 localStorage.setItem(key,JSON.stringify(pending));rpc.mockImplementation(name=>Promise.resolve(name==='get_tournament_create_receipt_v1'?{data:null,error:{message:'receipt unavailable'}}:{data:{ok:false,error:'unsupported_create_field'},error:null}));const view=await mount();await act(async()=>view.result.current.save(undefined,true));expect(JSON.parse(localStorage.getItem(key)!)).toEqual(pending);expect(view.result.current.pending).toEqual(pending);expect(done).not.toHaveBeenCalled();expect(rpc.mock.calls.map(x=>x[0])).toEqual(['get_tournament_create_receipt_v1','create_tournament_with_levels_v1']);
});

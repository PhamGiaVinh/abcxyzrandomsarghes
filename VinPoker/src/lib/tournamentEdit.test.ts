import {afterEach,describe,expect,it,vi} from 'vitest';
import {clearTournamentEdit,loadTournamentEditContext,parseTournamentEditRequest,readTournamentEditJournal,recoverTournamentEdit,
 retainTournamentEdit,submitTournamentEdit,tournamentEditJournalKey,type TournamentEditConfig,type TournamentEditRequest} from './tournamentEdit';
export const ids={actor:'e2010000-0000-4000-8000-000000000001',club:'e2010000-0000-4000-8000-000000000002',tour:'e2010000-0000-4000-8000-000000000003',request:'e2010000-0000-4000-8000-000000000004'};
export const config:TournamentEditConfig={name:'TEST complete config',start_time:'2026-12-20T05:00:00Z',buy_in:100000,rake_amount:10000,service_fee_amount:5000,
 guarantee_amount:null,starting_stack:20000,location:'TEST room',description:'TEST description',game_type:'nlh',minutes_per_level:20,late_reg_close_level:6};
export const state={config,levels:[],lifecycle:{club_id:ids.club,status:'active',live_status:'registering'}};
const request=():TournamentEditRequest=>({p_tournament_id:ids.tour,p_club_id:ids.club,p_expected_actor_id:ids.actor,p_request_id:ids.request,
 p_expected_state:state,p_config:config,p_levels:null});
const ack=(r:TournamentEditRequest)=>({ok:true,tournament_id:r.p_tournament_id,club_id:r.p_club_id,actor_id:r.p_expected_actor_id,request_id:r.p_request_id,state:{...state,config:r.p_config}});
afterEach(()=>vi.useRealTimers());
describe('atomic tournament edit transport and journal',()=>{
 it('validates exact actor/club/tour on context, with real zero fees and null GTD',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,tournament_id:ids.tour,club_id:ids.club,actor_id:ids.actor,can_edit_blinds:true,state},error:null});
  expect(await loadTournamentEditContext(rpc,ids.tour,ids.club,ids.actor)).toEqual({state,canEditBlinds:true});
  rpc.mockResolvedValue({data:{ok:true,tournament_id:ids.tour,club_id:ids.club,actor_id:'another',can_edit_blinds:true,state},error:null});
  await expect(loadTournamentEditContext(rpc,ids.tour,ids.club,ids.actor)).rejects.toThrow('context_unavailable');
 });
 it('uses one writer and reads its exact receipt after an unknown transport outcome',async()=>{
  const r=request();const rpc=vi.fn().mockResolvedValueOnce({data:null,error:{message:'response lost'}}).mockResolvedValueOnce({data:ack(r),error:null});
  expect(await submitTournamentEdit(rpc,r)).toEqual(state);
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(['edit_tournament_with_levels_v1','get_tournament_edit_receipt_v1']);
  for(const [,payload] of rpc.mock.calls)expect(payload).toEqual(r);
 });
 it('treats a missing receipt as unknown, not permission for another writer',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:false,error:'receipt_not_found'},error:null});
  await expect(recoverTournamentEdit(rpc,request())).rejects.toMatchObject({unknownOutcome:true});
  expect(rpc).toHaveBeenCalledOnce();expect(rpc.mock.calls[0][0]).toBe('get_tournament_edit_receipt_v1');
 });
 it.each(['wrong-request','wrong-amount','wrong-tour'])('does not accept a %s receipt as success',async(kind)=>{
  const r=request(),value=ack(r);
  const data=kind==='wrong-request'?{...value,request_id:ids.tour}:kind==='wrong-tour'?{...value,tournament_id:ids.club}
    :{...value,state:{...value.state,config:{...config,buy_in:1}}};
  await expect(recoverTournamentEdit(vi.fn().mockResolvedValue({data,error:null}),r)).rejects.toMatchObject({unknownOutcome:true});
 });
 it('accepts equal timestamp instants and object-key ordering, without bypassing config identity',async()=>{
  const r=request(),value=ack(r);value.state.config={...config,start_time:'2026-12-20T05:00:00+00:00'};
  expect((await submitTournamentEdit(vi.fn().mockResolvedValue({data:value,error:null}),r)).config.start_time).toBe('2026-12-20T05:00:00+00:00');
 });
 it('preserves pending payload in durable storage and never overwrites or clears a newer request',()=>{
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const r=request(),key=tournamentEditJournalKey(ids.actor,ids.club,ids.tour);retainTournamentEdit(storage,r);
  expect(readTournamentEditJournal(storage.getItem(key)!,ids.actor,ids.club,ids.tour)).toEqual(r);
  expect(()=>retainTournamentEdit(storage,{...r,p_config:{...config,name:'different'}})).toThrow('journal_changed');
  storage.setItem(key,JSON.stringify({...r,p_request_id:ids.tour}));
  expect(()=>clearTournamentEdit(storage,r)).toThrow('journal_changed');expect(storage.getItem(key)).not.toBeNull();
 });
 it('rejects wrong-scope journal, invalid money and an empty selected blind replacement',()=>{
  const r=request();expect(()=>parseTournamentEditRequest(r,ids.actor,ids.tour,ids.tour)).toThrow();
  expect(()=>parseTournamentEditRequest({...r,p_config:{...config,buy_in:null}},ids.actor,ids.club,ids.tour)).toThrow();
  expect(()=>parseTournamentEditRequest({...r,p_levels:[]},ids.actor,ids.club,ids.tour)).toThrow();
 });
 it('returns a known atomic rejection without retrying or echoing backend diagnostics',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{code:'P0001',message:'private raw backend error'}});
  await expect(submitTournamentEdit(rpc,request())).rejects.toMatchObject({code:'statement_rejected',unknownOutcome:false});expect(rpc).toHaveBeenCalledOnce();
 });
 it('bounds a hung receipt read and never starts a replacement mutation',async()=>{
  vi.useFakeTimers();const rpc=vi.fn().mockReturnValue(new Promise(()=>{}));const result=recoverTournamentEdit(rpc,request());
  const rejected=expect(result).rejects.toMatchObject({unknownOutcome:true});await vi.advanceTimersByTimeAsync(20001);await rejected;
  expect(rpc).toHaveBeenCalledOnce();
 });
});

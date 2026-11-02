import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {rankingReviewKey} from '@/lib/tournamentRankingReview';
import {computeCloseReport} from '@/lib/closeReport';
const h=vi.hoisted(()=>({rpc:vi.fn(),actor:'fa862000-0000-4000-8000-000000000001',session:{access_token:'LOCAL_ONLY'},signals:[] as AbortSignal[],report:null as unknown}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('@/hooks/useCloseReport',()=>({useCloseReport:()=>h.report}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:h.session,loading:false})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,params?:{name?:string;reference?:string})=>params?.name?`${key}:${params.name}`:params?.reference?`${key}:${params.reference}`:key})}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>{
 const client={rpc:(name:string,args:unknown)=>{const p=Promise.resolve(h.rpc(name,args));return Object.assign(p,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return p;}});}};
 return{useSupabaseClient:()=>client,useSupabaseBackendScope:()=> 'LOCAL862'};
});
import {TournamentRankingReviewPanel} from './TournamentRankingReviewPanel';
import CloseReportDialog from './CloseReportDialog';
const id=(n:number)=>`fa862000-0000-4000-8000-${String(n).padStart(12,'0')}`,tour=id(2);
const initial=()=>({ok:true,review:null as unknown,source:{tournamentId:tour,sourceHash:'a'.repeat(32),field:4,survivors:1,missingOrders:0,
 requiresReview:true,activeHand:false,evidencePending:false,hasOfficial:false,entries:[10,11,12,13].map((n,index)=>({entryId:id(n),playerId:id(n+20),entryNo:1,
 name:`TEST ${n}`,status:index?'busted':'registered',bustOrder:index?4-index:null,finishedPlace:null})),
 simultaneousHands:[id(40)],simultaneousGroups:[{handId:id(40),entryIds:[id(11),id(12)]}]}});
let current=initial(),receipt:Record<string,unknown>|null=null;
const blocked=vi.fn(),recorded=vi.fn();
const props={tournamentId:tour,required:true,enabled:true,onBlockingChange:blocked,onRecorded:recorded};
const key=()=>rankingReviewKey({backendScope:'LOCAL862',actorId:h.actor,tournamentId:tour});
beforeEach(()=>{
 sessionStorage.clear();h.signals=[];h.actor=id(1);h.rpc.mockReset();blocked.mockReset();recorded.mockReset();current=initial();receipt=null;
 h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='get_tournament_ranking_review_v1')return{data:current,error:null};
  if(name==='confirm_tournament_ranking_review_v1'){
   receipt={tournament_id:tour,actor_id:h.actor,request_id:args.p_request_id,source_hash:args.p_expected_source_hash,
    ordered_entry_ids:args.p_ordered_entry_ids,created_at:'2026-10-26T00:00:00Z'};current={...current,review:receipt};
   return{data:{ok:true,outcome:'recorded',review:receipt},error:null};
  }
  if(name==='get_tournament_ranking_review_receipt_v1')return{data:{ok:true,outcome:receipt?'recorded':'not_found',review:receipt,
   sourceCurrent:receipt?.source_hash===current.source.sourceHash,currentSourceHash:current.source.sourceHash},error:null};
  throw Error('unexpected RPC');
 });
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
const writes=()=>h.rpc.mock.calls.filter(([name])=>name==='confirm_tournament_ranking_review_v1');
it('allows only group-slot swaps and sends one retained confirmation',async()=>{
 render(<TournamentRankingReviewPanel {...props}/>);await screen.findByText('1. TEST 10 · #1');
 expect(screen.queryByRole('button',{name:'rankingReview.down:TEST 10'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'rankingReview.down:TEST 11'}));
 const confirm=screen.getByRole('button',{name:'rankingReview.confirm'});
 act(()=>{fireEvent.click(confirm);fireEvent.click(confirm);});
 await screen.findByText('rankingReview.recorded');expect(writes()).toHaveLength(1);
 expect(writes()[0][1].p_ordered_entry_ids).toEqual([id(10),id(12),id(11),id(13)]);
 expect(sessionStorage.getItem(key())).toBeNull();expect(recorded).toHaveBeenCalledOnce();
 await waitFor(()=>expect(blocked).toHaveBeenLastCalledWith(false));
});
it('keeps an unknown request across remount and recovers through a read, never another write',async()=>{
 const normal=h.rpc.getMockImplementation()!;
 h.rpc.mockImplementation(async(name,args)=>{const reply=await normal(name,args);if(name==='confirm_tournament_ranking_review_v1')throw new TypeError('Lost response');return reply;});
 const first=render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));
 await screen.findByText('rankingReview.pending');await waitFor(()=>expect(sessionStorage.getItem(key())).not.toBeNull());
 await waitFor(()=>expect(blocked).toHaveBeenLastCalledWith(true));first.unmount();
 render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.check'}));
 await screen.findByText('rankingReview.recorded');expect(writes()).toHaveLength(1);expect(sessionStorage.getItem(key())).toBeNull();
 expect(h.rpc.mock.calls.some(([name])=>name==='get_tournament_ranking_review_receipt_v1')).toBe(true);
});
it('does not promote a historical receipt to current approval after source change',async()=>{
 const normal=h.rpc.getMockImplementation()!;
 h.rpc.mockImplementation(async(name,args)=>{const reply=await normal(name,args);if(name==='confirm_tournament_ranking_review_v1'){
  current={...initial(),source:{...initial().source,sourceHash:'b'.repeat(32)}};throw Error('Lost response');}return reply;});
 render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));
 fireEvent.click(await screen.findByRole('button',{name:'rankingReview.check'}));
 await screen.findByText('rankingReview.historical');expect(sessionStorage.getItem(key())).toBeNull();expect(writes()).toHaveLength(1);
 await waitFor(()=>expect(blocked).toHaveBeenLastCalledWith(true));
});
it('does not clear the journal for a mismatched receipt',async()=>{
 const normal=h.rpc.getMockImplementation()!;
 h.rpc.mockImplementation(async(name,args)=>{const reply=await normal(name,args);if(name==='confirm_tournament_ranking_review_v1')
  return{data:{ok:true,outcome:'recorded',review:{...receipt,request_id:id(99)}},error:null};return reply;});
 render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));
 await screen.findByText('rankingReview.pending');await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('rankingReview.unknown'));
 expect(sessionStorage.getItem(key())).not.toBeNull();expect(recorded).not.toHaveBeenCalled();
});
it('bounds a hung read and aborts its transport without enabling confirmation',async()=>{
 vi.useFakeTimers();h.rpc.mockImplementation(()=>new Promise(()=>{}));render(<TournamentRankingReviewPanel {...props}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByRole('alert')).toHaveTextContent('rankingReview.readError');expect(h.signals.some(s=>s.aborted)).toBe(true);
 expect(screen.getByRole('button',{name:'rankingReview.confirm'})).toBeDisabled();expect(writes()).toHaveLength(0);
});
it('does not contact a missing new backend for an unaffected legacy close',async()=>{
 render(<TournamentRankingReviewPanel {...props} required={false}/>);
 await waitFor(()=>expect(blocked).toHaveBeenLastCalledWith(false));expect(h.rpc).not.toHaveBeenCalled();
});
it('retains a pending operation when the panel is disabled before its response',async()=>{
 let finish!:(value:unknown)=>void;const normal=h.rpc.getMockImplementation()!;
 h.rpc.mockImplementation((name,args)=>name==='confirm_tournament_ranking_review_v1'?new Promise(resolve=>{finish=resolve;}):normal(name,args));
 const rendered=render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));
 const saved=JSON.parse(sessionStorage.getItem(key())!);rendered.rerender(<TournamentRankingReviewPanel {...props} enabled={false}/>);
 await act(async()=>finish({data:{ok:true,outcome:'recorded',review:{tournament_id:tour,actor_id:h.actor,request_id:saved.requestId,
  source_hash:saved.sourceHash,ordered_entry_ids:saved.orderedEntryIds,created_at:'2026-10-26T00:00:00Z'}},error:null}));
 expect(sessionStorage.getItem(key())).not.toBeNull();expect(recorded).not.toHaveBeenCalled();
});
it('does not let an old actor completion clear its journal or update the new actor UI',async()=>{
 let finish!:(value:unknown)=>void;const normal=h.rpc.getMockImplementation()!;
 h.rpc.mockImplementation((name,args)=>name==='confirm_tournament_ranking_review_v1'?new Promise(resolve=>{finish=resolve;}):normal(name,args));
 const rendered=render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));
 const originalKey=key(),saved=JSON.parse(sessionStorage.getItem(originalKey)!);
 h.actor=id(90);rendered.rerender(<TournamentRankingReviewPanel {...props}/>);
 await act(async()=>finish({data:{ok:true,outcome:'recorded',review:{tournament_id:tour,actor_id:saved.actorId,request_id:saved.requestId,
  source_hash:saved.sourceHash,ordered_entry_ids:saved.orderedEntryIds,created_at:'2026-10-26T00:00:00Z'}},error:null}));
 expect(sessionStorage.getItem(originalKey)).not.toBeNull();expect(recorded).not.toHaveBeenCalled();
 expect(screen.queryByText('rankingReview.recorded')).toBeNull();expect(writes()).toHaveLength(1);
});
it('does not send any writer when durable storage cannot save the request',async()=>{
 render(<TournamentRankingReviewPanel {...props}/>);const confirm=await screen.findByRole('button',{name:'rankingReview.confirm'});
 vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw Error('storage unavailable');});fireEvent.click(confirm);
 await screen.findByText('rankingReview.storage');expect(writes()).toHaveLength(0);expect(recorded).not.toHaveBeenCalled();
});
it('shows an explicit missing-contract read error and supports a verified retry',async()=>{
 h.rpc.mockImplementationOnce(async()=>({data:null,error:{code:'PGRST202',message:'missing read contract'}}));
 render(<TournamentRankingReviewPanel {...props}/>);await screen.findByText('rankingReview.readError');expect(writes()).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'rankingReview.reload'}));await screen.findByText('1. TEST 10 · #1');
 expect(screen.getByRole('button',{name:'rankingReview.confirm'})).toBeEnabled();
});
it('retains an explicit first-send business rejection while refreshing the changed source',async()=>{
 const normal=h.rpc.getMockImplementation()!;
 h.rpc.mockImplementation((name,args)=>{
  if(name==='confirm_tournament_ranking_review_v1'){
   current={...initial(),source:{...initial().source,sourceHash:'b'.repeat(32)}};
   return{data:null,error:{code:'P0001',message:'ranking_review_source_changed'}};
  }return normal(name,args);
 });
 render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));
 await screen.findByText('rankingReview.changed');await waitFor(()=>expect(sessionStorage.getItem(key())).toBeNull());
 expect(screen.queryByText('rankingReview.recorded')).toBeNull();expect(writes()).toHaveLength(1);
});
it('can reconcile a saved receipt even while the current roster read is hung',async()=>{
 const normal=h.rpc.getMockImplementation()!;let reads=0;
 h.rpc.mockImplementation(async(name,args)=>{
  if(name==='get_tournament_ranking_review_v1'&&++reads>1)return new Promise(()=>{});
  const reply=await normal(name,args);if(name==='confirm_tournament_ranking_review_v1')throw Error('Lost response');return reply;
 });
 const rendered=render(<TournamentRankingReviewPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));
 const recover=await screen.findByRole('button',{name:'rankingReview.check'});await waitFor(()=>expect(recover).toBeEnabled());
 fireEvent.click(recover);await screen.findByText('rankingReview.recorded');
 expect(writes()).toHaveLength(1);expect(sessionStorage.getItem(key())).toBeNull();expect(recorded).toHaveBeenCalledOnce();
 expect(blocked).toHaveBeenLastCalledWith(true);
 rendered.rerender(<TournamentRankingReviewPanel {...props} required={false}/>);
 expect(screen.queryByText('rankingReview.loading')).toBeNull();expect(blocked).toHaveBeenLastCalledWith(false);
});
it('distinguishes same-name participants by entry reference when choosing an order',async()=>{
 current.source.entries[1].name='TEST DUPLICATE';current.source.entries[2].name='TEST DUPLICATE';
 render(<TournamentRankingReviewPanel {...props}/>);
 const move=await screen.findByRole('button',{name:'rankingReview.down:TEST DUPLICATE · 00000011'});
 expect(screen.getByText('rankingReview.reference:00000011')).toBeInTheDocument();
 expect(screen.getByText('rankingReview.reference:00000012')).toBeInTheDocument();
 fireEvent.click(move);fireEvent.click(screen.getByRole('button',{name:'rankingReview.confirm'}));
 await screen.findByText('rankingReview.recorded');expect(writes()[0][1].p_ordered_entry_ids).toEqual([id(10),id(12),id(11),id(13)]);
});
it('integrates the real close dialog and panel: server-ready state cannot bypass a lost-response journal',async()=>{
 const normal=h.rpc.getMockImplementation()!,close=vi.fn().mockResolvedValue({ok:true,reconciled:true});
 const reload=vi.fn();const reportState=(needsReview:boolean)=>({report:computeCloseReport({entries:[],payouts:[]}),loading:false,
  error:null,alreadyClosed:false,reload,closeTournament:close,readiness:{ok:true,ready:!needsReview,alreadyClosed:false,
   blockers:needsReview?['manual_ranking_review_required']:[]}});
 h.report=reportState(true);reload.mockImplementation(()=>{if(current.review)h.report=reportState(false);});
 h.rpc.mockImplementation(async(name,args)=>{const reply=await normal(name,args);if(name==='confirm_tournament_ranking_review_v1')throw Error('Lost response');return reply;});
 const closeProps={open:true,onOpenChange:vi.fn(),tournamentId:tour,tournamentName:'LOCAL862 TEST'};
 const rendered=render(<CloseReportDialog {...closeProps}/>);
 expect(screen.getByRole('button',{name:'Tiếp tục'})).toBeDisabled();
 fireEvent.click(await screen.findByRole('button',{name:'rankingReview.confirm'}));await screen.findByText('rankingReview.pending');
 h.report=reportState(false);rendered.rerender(<CloseReportDialog {...closeProps}/>);
 expect(screen.getByRole('button',{name:'Tiếp tục'})).toBeDisabled();expect(close).not.toHaveBeenCalled();
 const recover=screen.getByRole('button',{name:'rankingReview.check'});await waitFor(()=>expect(recover).toBeEnabled());fireEvent.click(recover);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Tiếp tục'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Tiếp tục'}));fireEvent.change(screen.getByPlaceholderText('CHOT GIAI'),{target:{value:'CHOT GIAI'}});
 fireEvent.click(screen.getByRole('button',{name:'Chốt giải'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce());
 expect(writes()).toHaveLength(1);expect(sessionStorage.getItem(key())).toBeNull();
});

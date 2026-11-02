import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useAuth} from '@/hooks/useAuth';
import {useSupabaseBackendScope,useSupabaseClient} from '@/integrations/supabase/SupabaseClientContext';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {Button} from '@/components/ui/button';
import {clearRankingIntent,parseRankingIntent,parseRankingReceipt,parseRankingView,persistRankingIntent,rankingReviewKey,validRankingOrder,
 type RankingReviewIntent,type RankingReviewScope,type RankingReviewView} from '@/lib/tournamentRankingReview';

type Props={tournamentId:string;required:boolean;enabled:boolean;onBlockingChange:(blocked:boolean)=>void;onRecorded:()=>void};
type RpcResult={data:unknown;error:{message?:string;code?:string}|null};
type RankingRpc=(name:string,args:Record<string,unknown>)=>PromiseLike<RpcResult>&{abortSignal:(signal:AbortSignal)=>PromiseLike<RpcResult>};
const definitive=new Set(['ranking_review_source_changed','ranking_review_not_ready','ranking_review_results_immutable',
 'ranking_review_invalid_order','ranking_review_unrelated_place_changed','ranking_review_already_recorded']);

export function TournamentRankingReviewPanel(props:Props){
 const {user,session,loading}=useAuth(),client=useSupabaseClient();
 const backendScope=useSupabaseBackendScope()??'canonical';
 const clientLifetime=useMemo(()=>({client,key:crypto.randomUUID()}),[client]);
 const key=JSON.stringify([clientLifetime.key,backendScope,user?.id,sessionReadEpoch(session),!!loading,props.tournamentId]);
 return <RankingReviewLifetime key={key} {...props} actorId={user?.id??null} authLoading={!!loading} backendScope={backendScope} client={clientLifetime.client}/>;
}

function RankingReviewLifetime({actorId,authLoading,backendScope,client,...props}:Props&{
 actorId:string|null;authLoading:boolean;backendScope:string;client:ReturnType<typeof useSupabaseClient>;
}){
 const {t}=useTranslation();
 const scope=useMemo<RankingReviewScope|null>(()=>actorId?{actorId,tournamentId:props.tournamentId,backendScope}:null,[actorId,props.tournamentId,backendScope]);
 const [ready,setReady]=useState(false),[storageError,setStorageError]=useState(false),[pending,setPending]=useState<RankingReviewIntent|null>(null);
 const [view,setView]=useState<RankingReviewView|null>(null),[draft,setDraft]=useState<string[]>([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const [error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const [readError,setReadError]=useState(false);
 const alive=useRef(false),working=useRef(false),operation=useRef<AbortController|null>(null);
 const enabled=useRef(props.enabled);enabled.current=props.enabled;
 const rpc=useMemo(()=>client.rpc.bind(client) as unknown as RankingRpc,[client]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;operation.current?.abort();};},[]);
 useEffect(()=>{
  if(!props.enabled)return;
  try{
   if(scope){const raw=sessionStorage.getItem(rankingReviewKey(scope));setPending(raw===null?null:parseRankingIntent(raw,scope));}
   setReady(true);
  }catch{setStorageError(true);setReady(true);}
 },[props.enabled,scope]);
 useEffect(()=>{
  if(!props.enabled||!ready||!scope||authLoading||(!props.required&&!pending)){
   setLoading(false);
   if(!props.required&&!pending){setView(null);setReadError(false);}
   return;
  }
  let current=true;const controller=new AbortController();setLoading(true);setView(null);setReadError(false);
  void(async()=>{
   try{
    const response=await observeTrackerContextRead(rpc('get_tournament_ranking_review_v1',{p_tournament_id:scope.tournamentId}).abortSignal(controller.signal));
    if(!current)return;if(response.error)throw Error('ranking_read_failed');
    const next=parseRankingView(response.data,scope.tournamentId);setView(next);
    setDraft(next.review?.ordered_entry_ids??next.source.entries.map(entry=>entry.entryId));
   }catch{if(current)setReadError(true);}
   finally{controller.abort();if(current)setLoading(false);}
  })();
  return()=>{current=false;controller.abort();};
 },[props.enabled,props.required,ready,scope,authLoading,pending,rpc,attempt]);
 const s=view?.source;
 const eligible=!!s&&s.requiresReview&&!s.hasOfficial&&!s.activeHand&&!s.evidencePending&&s.missingOrders===0&&s.survivors===1;
 const blocked=props.enabled&&(!ready||storageError||!!pending||busy||(props.required&&(!scope||authLoading||loading||!view||!eligible||!view.review)));
 const {onBlockingChange}=props;
 useLayoutEffect(()=>{onBlockingChange(blocked);},[blocked,onBlockingChange]);

 const execute=async(intent:RankingReviewIntent,recovery:boolean)=>{
  if(working.current||!alive.current||!enabled.current)return;working.current=true;setBusy(true);setError(null);setNotice(null);
  const controller=new AbortController();operation.current=controller;
  try{
   const response=await waitForManualPlayerResponse(Promise.resolve(recovery
    ?rpc('get_tournament_ranking_review_receipt_v1',{p_tournament_id:intent.tournamentId,p_request_id:intent.requestId,p_expected_actor_id:intent.actorId}).abortSignal(controller.signal)
    :rpc('confirm_tournament_ranking_review_v1',{p_tournament_id:intent.tournamentId,p_expected_source_hash:intent.sourceHash,
     p_ordered_entry_ids:intent.orderedEntryIds,p_request_id:intent.requestId,p_expected_actor_id:intent.actorId}).abortSignal(controller.signal)));
   if(!alive.current||!enabled.current)return;
   if(response.error){
    if(!recovery&&response.error.code==='P0001'&&definitive.has(response.error.message??'')){
     clearRankingIntent(sessionStorage,intent);setPending(null);setError('changed');setAttempt(x=>x+1);props.onRecorded();return;
    }
    throw Error('ranking_write_unknown');
   }
   const receipt=parseRankingReceipt(intent,response.data,recovery);
   if(!receipt.recorded){setError('unknown');return;}
   clearRankingIntent(sessionStorage,intent);setPending(null);setNotice(receipt.current?'recorded':'historical');
   setAttempt(x=>x+1);props.onRecorded();
  }catch{if(alive.current&&enabled.current)setError('unknown');}
  finally{controller.abort();working.current=false;if(operation.current===controller)operation.current=null;if(alive.current)setBusy(false);}
 };
 const submit=async()=>{
  if(!scope||!view||!eligible||view.review||pending||storageError||!ready||loading||working.current||!validRankingOrder(view.source,draft))return;
  try{
   const intent=parseRankingIntent(JSON.stringify({...scope,requestId:crypto.randomUUID(),sourceHash:view.source.sourceHash,orderedEntryIds:draft}),scope);
   persistRankingIntent(sessionStorage,intent);setPending(intent);await execute(intent,false);
  }catch{if(alive.current)setStorageError(true);}
 };
 const swap=(index:number,direction:-1|1)=>{
  if(!s||pending||busy||view?.review)return;
  const group=s.simultaneousGroups.find(g=>g.entryIds.includes(draft[index]));if(!group)return;
  const indices=draft.flatMap((id,i)=>group.entryIds.includes(id)?[i]:[]),position=indices.indexOf(index),other=indices[position+direction];
  if(other===undefined)return;setDraft(current=>{const next=[...current];[next[index],next[other]]=[next[other],next[index]];return next;});
 };
 if(!props.enabled||(!props.required&&!pending&&!storageError&&!notice&&!error&&!readError))return null;
 return <section className="space-y-3 rounded-lg border border-border p-3" aria-label={t('rankingReview.title')}>
  <h3 className="text-sm font-semibold">{t('rankingReview.title')}</h3>
  <p className="text-xs text-muted-foreground">{t('rankingReview.note')}</p>
  {storageError&&<p role="alert" className="text-sm text-destructive">{t('rankingReview.storage')}</p>}
  {error&&<p role="alert" className="text-sm text-destructive">{t(`rankingReview.${error}`)}</p>}
  {readError&&<p role="alert" className="text-sm text-destructive">{t('rankingReview.readError')}</p>}
  {notice&&<p role="status" className="text-sm">{t(`rankingReview.${notice}`)}</p>}
  {(!ready||loading)&&<p role="status" className="text-sm">{t('rankingReview.loading')}</p>}
  {pending&&<div className="flex flex-wrap gap-2">
   <p role="status" className="w-full text-sm">{t('rankingReview.pending')}</p>
   <Button className="min-h-11" variant="outline" disabled={busy} onClick={()=>void execute(pending,true)}>{t('rankingReview.check')}</Button>
   <Button className="min-h-11" variant="outline" disabled={busy||loading||!view||view.source.sourceHash!==pending.sourceHash} onClick={()=>void execute(pending,false)}>{t('rankingReview.retrySame')}</Button>
  </div>}
  {!pending&&(error||readError)&&<Button className="min-h-11" variant="outline" disabled={loading||busy} onClick={()=>setAttempt(x=>x+1)}>{t('rankingReview.reload')}</Button>}
  {s&&!eligible&&!view?.review&&<p role="status" className="text-sm">{t('rankingReview.notReady')}</p>}
  {view?.review&&<p role="status" className="text-sm">{t('rankingReview.approved')}</p>}
  {s&&<ol className="space-y-2">{draft.map((entryId,index)=>{
   const entry=s.entries.find(e=>e.entryId===entryId);if(!entry)return null;
   const group=s.simultaneousGroups.find(g=>g.entryIds.includes(entryId));
   const shortReference=entryId.slice(-8);
   const reference=s.entries.some(other=>other.entryId!==entryId&&other.entryId.endsWith(shortReference))?entryId:shortReference;
   const actionName=s.entries.some(other=>other.entryId!==entryId&&other.name===entry.name)?`${entry.name} · ${reference}`:entry.name;
   const peers=draft.flatMap((id,i)=>group?.entryIds.includes(id)?[i]:[]),position=peers.indexOf(index);
   return <li key={entryId} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
    <span className="min-w-0 flex-1 break-words">{index+1}. {entry.name} · #{entry.entryNo}
     <span className="block text-xs text-muted-foreground">{t('rankingReview.reference',{reference})}</span>
     {group&&<span className="block text-xs text-muted-foreground">{t('rankingReview.group',{group:s.simultaneousGroups.indexOf(group)+1})}</span>}
    </span>
    {group&&!view?.review&&<div className="flex gap-1">
     <Button className="min-h-11 min-w-11" size="sm" variant="outline" aria-label={t('rankingReview.up',{name:actionName})} disabled={!!pending||busy||loading||position<=0} onClick={()=>swap(index,-1)}>↑</Button>
     <Button className="min-h-11 min-w-11" size="sm" variant="outline" aria-label={t('rankingReview.down',{name:actionName})} disabled={!!pending||busy||loading||position===peers.length-1} onClick={()=>swap(index,1)}>↓</Button>
    </div>}
   </li>;
  })}</ol>}
  {!pending&&!view?.review&&<Button className="min-h-11" disabled={!eligible||loading||busy||!ready||storageError||!scope||!s||!validRankingOrder(s,draft)} onClick={()=>void submit()}>{t('rankingReview.confirm')}</Button>}
 </section>;
}

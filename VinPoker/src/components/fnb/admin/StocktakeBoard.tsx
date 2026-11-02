import {observeTrackerContextRead} from "@/lib/tournament/observeTrackerContextRead";
import { useEffect, useRef, useState } from "react";
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {useAuth} from '@/hooks/useAuth';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {fnbShiftBackend} from '@/lib/fnbShiftIntent';
import {readStocktakeLineHold,writeStocktakeLineHold,stocktakeLineHoldKey,type StocktakeLineHold} from '@/lib/fnbStocktakeLineHold';
import {readStocktakeOperation,writeStocktakeOperation,rejectStocktakeOperationCountsChanged,stocktakeOperationKey,type StocktakeOperationIntent} from '@/lib/fnbStocktakeOperationIntent';
import {resolveStocktakeOperationReceipt} from '@/lib/fnbStocktakeOperationReceipt';
import {canonicalVoiceJson} from '@/lib/trackerVoice/canonicalRequest';
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableFooter, TableRow } from "@/components/ui/table";
import { Loader2, ClipboardCheck, Check } from "lucide-react";

const unsavedCounts=(draft:Record<string,string>,saved:Record<string,string>)=>Object.keys({...draft,...saved}).some(id=>{
  const value=draft[id];
  if(value===undefined||value.trim()==='')return saved[id]!==undefined;
  return !Number.isFinite(Number(value))||Number(value)<0||saved[id]===undefined||value.trim()!==saved[id].trim();
});
type LineReply={data:unknown;error:unknown};
type LineRequest=PromiseLike<LineReply>&{abortSignal:(signal:AbortSignal)=>PromiseLike<LineReply>};
type RecoveryReply=LineReply&{count?:number|null};
type RecoveryQuery=PromiseLike<RecoveryReply>&{select:(columns:string,options?:{count:'exact'})=>RecoveryQuery;eq:(key:string,value:string)=>RecoveryQuery;limit:(count:number)=>RecoveryQuery;abortSignal:(signal:AbortSignal)=>RecoveryQuery;maybeSingle:()=>PromiseLike<RecoveryReply>};
type CommitConfirmation={scope:string;sessionId:string;counts:Record<string,string>};

export function StocktakeBoard({ clubId }: { clubId: string }) {
  const {user,session,loading}=useAuth();
  if(loading)return <Card role="status" className="p-5">Đang tải phiên kiểm kho…</Card>;
  if(!user||!session?.access_token)return <Card role="alert" className="p-5">Đăng nhập để kiểm kho.</Card>;
  return <ScopedStocktakeBoard key={JSON.stringify([user.id,clubId,sessionReadEpoch(session),import.meta.env.VITE_SUPABASE_URL])} actorId={user.id} clubId={clubId}/>;
}

function ScopedStocktakeBoard({actorId,clubId}:{actorId:string;clubId:string}){
  const qc = useQueryClient();
  const { data, isLoading: menuLoading, isError: menuError, refetch: reloadMenu } = useFnbMenu(clubId);
  const ingredients = (data?.ingredients ?? []).filter((i) => i.is_active);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [savedCounted,setSavedCounted]=useState<Record<string,string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [lineFailureCount,setLineFailureCount]=useState(0);
  const draftRef=useRef(counted),savedRef=useRef(savedCounted),lineHolds=useRef(new Set<string>());
  draftRef.current=counted;savedRef.current=savedCounted;
  const mounted=useRef(false),commitWorking=useRef(false);
  const lineWorking=useRef<{scope:string;controller:AbortController}|null>(null);
  const operationWorking=useRef<{scope:string;controller:AbortController}|null>(null);
  const [durableHold,setDurableHold]=useState<StocktakeLineHold|null>(null),[journalUnavailable,setJournalUnavailable]=useState(true),[peerChanged,setPeerChanged]=useState(false);
  const [durableOperation,setDurableOperation]=useState<StocktakeOperationIntent|null>(null);
  const [rejectedOperation,setRejectedOperation]=useState(false);
  const [commitConfirmation,setCommitConfirmation]=useState<CommitConfirmation|null>(null);
  const [journalChecked,setJournalChecked]=useState(false),[recovering,setRecovering]=useState(false),[recoveryMessage,setRecoveryMessage]=useState<string|null>(null);
  const recoveryWorking=useRef<{scope:string;controller:AbortController}|null>(null);
  const ownRequests=useRef(new Set<string>()),seenJournal=useRef<string|null|undefined>(undefined);
  const seenOperation=useRef<string|null|undefined>(undefined);
  const peerChangeRef=useRef(false);
  let backend='';try{backend=fnbShiftBackend(import.meta.env.VITE_SUPABASE_URL);}catch{/* Missing backend must hold writes. */}
  const refreshJournal=()=>{
    if(!mounted.current)return;
    try{
      if(!backend||!navigator.locks?.request)throw new Error('stocktake_journal_unavailable');
      const row=readStocktakeLineHold(localStorage,actorId,clubId,backend),op=readStocktakeOperation(localStorage,actorId,clubId,backend);
      for(const [value,seen] of [[row,seenJournal],[op,seenOperation]] as const){
        const token=value?value.state+':'+value.intent.requestId:null;
        if(seen.current!==undefined&&token!==seen.current&&(!value||!ownRequests.current.has(value.intent.requestId))){peerChangeRef.current=true;setPeerChanged(true);}
        seen.current=token;
      }
      setDurableHold(row?.state==='pending'?row.intent:null);setDurableOperation(op?.state==='pending'?op.intent:null);setJournalUnavailable(false);setJournalChecked(true);
      setRejectedOperation(op?.state==='counts_changed');
    }catch{setJournalUnavailable(true);setJournalChecked(true);}
  };
  const withLineBarrier=async(work:()=>Promise<void>)=>{
    if(!backend||!navigator.locks?.request){setJournalUnavailable(true);return;}
    await navigator.locks.request(stocktakeLineHoldKey(actorId,clubId,backend),async()=>{
      if(!mounted.current)return;
      let row:ReturnType<typeof readStocktakeLineHold>;
      let op:ReturnType<typeof readStocktakeOperation>;
      try{row=readStocktakeLineHold(localStorage,actorId,clubId,backend);op=readStocktakeOperation(localStorage,actorId,clubId,backend);}catch{setJournalUnavailable(true);return;}
      const changed=([[row,seenJournal],[op,seenOperation]] as const).some(([value,seen])=>{
        const token=value?value.state+':'+value.intent.requestId:null;
        return seen.current!==undefined&&token!==seen.current&&(!value||!ownRequests.current.has(value.intent.requestId));
      });
      if(row?.state==='pending'||op?.state==='pending'||peerChangeRef.current||changed){refreshJournal();return;}
      try{await work();}finally{refreshJournal();}
    });
  };

  const [loadedClub,setLoadedClub]=useState<string|null>(null),[readErrorClub,setReadErrorClub]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
  const operationScope=JSON.stringify([clubId,attempt,sessionId]),scopeRef=useRef(operationScope);scopeRef.current=operationScope;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;lineWorking.current?.controller.abort();operationWorking.current?.controller.abort();recoveryWorking.current?.controller.abort();};},[]);
  useEffect(()=>{
    refreshJournal();
    const changed=(event:StorageEvent)=>{try{if(event.key===null||event.key===stocktakeLineHoldKey(actorId,clubId,backend)||event.key===stocktakeOperationKey(actorId,clubId,backend))refreshJournal();}catch{setJournalUnavailable(true);}};
    window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
    // The wrapper remounts on actor, club, credential or backend changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[actorId,clubId,backend]);
  const readReady=loadedClub===clubId&&!loading&&readErrorClub!==clubId;
  const menuUnavailable=menuLoading||menuError||!data;
  const reloadSession=()=>{setLoadedClub(null);setAttempt(value=>value+1);};
  useEffect(()=>{
    let active=true;const controller=new AbortController();setLoading(true);setLoadedClub(null);setReadErrorClub(null);
    lineWorking.current?.controller.abort();lineWorking.current=null;setSavingId(null);
    operationWorking.current?.controller.abort();operationWorking.current=null;commitWorking.current=false;setBusy(false);
    recoveryWorking.current?.controller.abort();
    void (async()=>{
      try{
        if(!clubId)throw new Error('stocktake_club_missing');
        const snapshot=await observeTrackerContextRead((async()=>{
          const sb=supabase as any;
          const session=await sb.from('fnb_stocktakes').select('id').eq('club_id',clubId).eq('status','open').limit(1).abortSignal(controller.signal).maybeSingle();
          if(controller.signal.aborted)throw new Error('stocktake_read_cancelled');
          if(session.error)throw session.error;
          if(session.data===null)return {sessionId:null,counted:{} as Record<string,string>};
          if(!session.data||typeof session.data!=='object'||Array.isArray(session.data)||typeof session.data.id!=='string'||!session.data.id.trim())throw new Error('stocktake_session_invalid');
          const lines=await sb.from('fnb_stocktake_lines').select('ingredient_id, counted_qty').eq('stocktake_id',session.data.id).abortSignal(controller.signal);
          if(controller.signal.aborted)throw new Error('stocktake_read_cancelled');
          if(lines.error||!Array.isArray(lines.data))throw new Error('stocktake_lines_unverified');
          const counted:Record<string,string>={};
          for(const value of lines.data as unknown[]){
            if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('stocktake_line_invalid');
            const row=value as Record<string,unknown>;
            if(typeof row.ingredient_id!=='string'||!row.ingredient_id.trim()||Object.prototype.hasOwnProperty.call(counted,row.ingredient_id)
              ||!(typeof row.counted_qty==='number'||typeof row.counted_qty==='string'&&row.counted_qty.trim()!=='')||!Number.isFinite(Number(row.counted_qty))||Number(row.counted_qty)<0)throw new Error('stocktake_line_invalid');
            counted[row.ingredient_id]=String(row.counted_qty);
          }
          return {sessionId:session.data.id as string,counted};
        })());
        if(!active)return;
        setSessionId(snapshot.sessionId);setCounted(snapshot.counted);setSavedCounted(snapshot.counted);
        draftRef.current=snapshot.counted;savedRef.current=snapshot.counted;lineHolds.current.clear();setLineFailureCount(0);setLoadedClub(clubId);
      }catch{controller.abort();if(active)setReadErrorClub(clubId);}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;controller.abort();};
  },[clubId,attempt]);

  const runOperation=async(kind:'open'|'commit',confirmed?:CommitConfirmation)=>{
    if(operationWorking.current)return;
    const operation={scope:operationScope,controller:new AbortController()};operationWorking.current=operation;
    const current=()=>mounted.current&&scopeRef.current===operation.scope&&operationWorking.current===operation;
    commitWorking.current=kind==='commit';setBusy(true);setRecoveryMessage(null);
    let dispatched=false;
    try{await withLineBarrier(async()=>{
      if(!current())return;
      if(kind==='commit'&&(!confirmed||confirmed.scope!==scopeRef.current||confirmed.sessionId!==sessionId
        ||canonicalVoiceJson(confirmed.counts)!==canonicalVoiceJson(savedRef.current)))return;
      const scope={actorId,clubId,backend,requestId:crypto.randomUUID()};
      const intent:StocktakeOperationIntent=kind==='open'?{...scope,kind}:{...scope,kind,sessionId:confirmed!.sessionId,counts:{...confirmed!.counts}};
      writeStocktakeOperation(localStorage,intent);ownRequests.current.add(intent.requestId);refreshJournal();
      const rpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>LineRequest;
      dispatched=true;
      const {data:out,error}=await waitForManualPlayerResponse(Promise.resolve(rpc(kind==='open'?'fnb_open_stocktake':'fnb_commit_stocktake_confirmed_v1',kind==='open'
        ?{p_club_id:clubId,p_note:null,p_client_request_id:intent.requestId}:{p_stocktake_id:intent.kind==='commit'?intent.sessionId:sessionId,p_expected_counts:intent.kind==='commit'?intent.counts:{}}).abortSignal(operation.controller.signal)));
      const reply=out as Record<string,unknown>|null;
      if(!error&&intent.kind==='commit'&&reply&&typeof reply==='object'&&!Array.isArray(reply)
        &&Object.keys(reply).length===1&&reply.error==='STOCKTAKE_COUNTS_CHANGED'){
        rejectStocktakeOperationCountsChanged(localStorage,intent);refreshJournal();
        if(current()){
          toast.error('Yêu cầu chốt bị từ chối vì số đếm đã đổi. Đọc lại số đếm hiện tại trước khi xác nhận lại.');
          reloadSession();
        }
        return;
      }
      const freshCommit=!!reply&&reply.committed===true&&reply.idempotent!==true&&typeof reply.adjusted_lines==='number'&&Number.isSafeInteger(reply.adjusted_lines)&&reply.adjusted_lines>=0;
      const replayCommit=!!reply&&reply.idempotent===true&&reply.committed===undefined&&reply.adjusted_lines===undefined;
      const confirmedCommit=intent.kind==='commit'&&!!reply&&reply.counts_confirmed===true&&reply.stocktake_id===intent.sessionId;
      const validOpen=!!reply&&typeof reply.stocktake_id==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(reply.stocktake_id)&&typeof reply.idempotent==='boolean';
      if(error||!reply||reply.status!=='ok'||!(kind==='open'?validOpen:confirmedCommit&&(freshCommit||replayCommit)))throw new Error('stocktake_operation_unverified');
      if(kind==='commit'){
        // Retain canonical receipt verification even with the server snapshot-bound command.
        // Keep the original intent pending until explicit canonical receipt READ proves it.
        refreshJournal();
        if(current())setRecoveryMessage('Máy chủ đã phản hồi chốt phiên. Cần đối chiếu số đếm đã chốt trước khi xác nhận hoàn tất.');
        return;
      }
      writeStocktakeOperation(localStorage,intent,true);refreshJournal();
      if(!current())return;
      reloadSession();
    });}catch{if(current()){refreshJournal();if(!dispatched)setJournalUnavailable(true);toast.error('Chưa xác minh kết quả kiểm kho. Giữ yêu cầu gốc; không tự gửi lại.');}}
    finally{operation.controller.abort();if(operationWorking.current===operation){operationWorking.current=null;commitWorking.current=false;if(mounted.current)setBusy(false);}}
  };
  const createSession=async()=>{
    if(!readReady||menuUnavailable||busy||sessionId||journalUnavailable||durableHold||durableOperation||peerChanged||recoveryWorking.current)return;
    await runOperation('open');
  };

  // Save one counted line on blur (only when it's a valid, changed number).
  const saveLine = async (ingredientId: string, raw: string) => {
    if (!sessionId||!readReady||menuUnavailable||busy||lineWorking.current||lineHolds.current.size||journalUnavailable||durableHold||durableOperation||peerChanged||recoveryWorking.current) return;
    const v = raw.trim();
    if (v === "") return;
    const qty = Number(v);
    if (!Number.isFinite(qty)||qty<0) { toast.error("Số đếm không hợp lệ."); return; }
    const operation={scope:operationScope,controller:new AbortController()};lineWorking.current=operation;
    const current=()=>mounted.current&&scopeRef.current===operation.scope;
    setSavingId(ingredientId);
    try{
      await withLineBarrier(async()=>{
      if(!current())return;
      const intent:StocktakeLineHold={actorId,clubId,backend,requestId:crypto.randomUUID(),sessionId,ingredientId,countedQty:qty};
      writeStocktakeLineHold(localStorage,intent);ownRequests.current.add(intent.requestId);refreshJournal();
      const rpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>LineRequest;
      const {data:out,error}=await waitForManualPlayerResponse(Promise.resolve(rpc('fnb_set_stocktake_line',{
        p_stocktake_id:sessionId,p_ingredient_id:ingredientId,p_counted_qty:qty,
      }).abortSignal(operation.controller.signal)));
      const reply=out as Record<string,unknown>|null;
      if(error||!reply||reply.status!=='ok'||reply.stocktake_id!==sessionId||reply.ingredient_id!==ingredientId
        ||typeof reply.counted_qty!=='number'||reply.counted_qty!==qty)throw new Error('stocktake_line_unverified');
      writeStocktakeLineHold(localStorage,intent,true);refreshJournal();
      if(!current())return;
      savedRef.current={...savedRef.current,[ingredientId]:v};setSavedCounted(savedRef.current);
      lineHolds.current.delete(ingredientId);setLineFailureCount(lineHolds.current.size);
      });
    }catch{if(current()){lineHolds.current.add(ingredientId);setLineFailureCount(lineHolds.current.size);toast.error('Chưa xác minh được số đếm đã lưu. Bản nháp được giữ; chưa thể chốt kiểm kho.');}}
    finally{operation.controller.abort();if(lineWorking.current===operation){lineWorking.current=null;if(current())setSavingId(null);}}
  };

  const canCommit=()=>!!sessionId&&readReady&&!menuUnavailable&&!busy&&!commitWorking.current&&!lineWorking.current&&!lineHolds.current.size
    &&!unsavedCounts(draftRef.current,savedRef.current)&&!journalUnavailable&&!durableHold&&!durableOperation&&!peerChanged&&!recoveryWorking.current;
  const commitReady=canCommit();
  useEffect(()=>{
    if(commitConfirmation&&(!commitReady||commitConfirmation.scope!==operationScope||commitConfirmation.sessionId!==sessionId
      ||canonicalVoiceJson(commitConfirmation.counts)!==canonicalVoiceJson(savedCounted)))setCommitConfirmation(null);
  },[commitConfirmation,commitReady,operationScope,sessionId,savedCounted]);
  const commit = () => {
    if(!canCommit())return;
    setCommitConfirmation({scope:operationScope,sessionId:sessionId!,counts:{...savedRef.current}});
  };
  const confirmCommit=async()=>{
    const confirmed=commitConfirmation;setCommitConfirmation(null);
    if(!confirmed||!canCommit()||confirmed.scope!==operationScope||confirmed.sessionId!==sessionId
      ||canonicalVoiceJson(confirmed.counts)!==canonicalVoiceJson(savedRef.current))return;
    await runOperation('commit',confirmed);
  };

  const recoverOperation=async()=>{
    if(!durableOperation||busy||journalUnavailable||recoveryWorking.current||!navigator.locks?.request)return;
    const frozen=durableOperation,operation={scope:operationScope,controller:new AbortController()};recoveryWorking.current=operation;
    const current=()=>mounted.current&&scopeRef.current===operation.scope&&recoveryWorking.current===operation;
    setRecovering(true);setRecoveryMessage(null);
    let timer:ReturnType<typeof setTimeout>|undefined,abort!:()=>void;
    const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new Error('stocktake_recovery_cancelled'));operation.controller.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>operation.controller.abort(),10000);});
    let found=false;
    try{
      const lookup=navigator.locks.request(stocktakeLineHoldKey(actorId,clubId,backend),{signal:operation.controller.signal},async()=>{
        if(!current()||operation.controller.signal.aborted)return;
        const before=readStocktakeOperation(localStorage,actorId,clubId,backend);
        if(!before||canonicalVoiceJson(before.intent)!==canonicalVoiceJson(frozen))throw new Error('stocktake_recovery_changed');
        const from=supabase.from.bind(supabase) as unknown as (table:string)=>RecoveryQuery;
        const snapshot=await Promise.race([(async()=>{
          let query=from('fnb_stocktakes').select('id,club_id,client_request_id,note,status,created_by,created_at,committed_by,committed_at').eq('club_id',clubId);
          query=frozen.kind==='open'?query.eq('client_request_id',frozen.requestId):query.eq('id',frozen.sessionId);
          const header=await query.abortSignal(operation.controller.signal).maybeSingle();if(header.error)throw new Error('stocktake_recovery_unavailable');
          if(frozen.kind==='open')return resolveStocktakeOperationReceipt(frozen,header.data);
          if(operation.controller.signal.aborted)throw new Error('stocktake_recovery_cancelled');
          const lines=await from('fnb_stocktake_lines').select('stocktake_id,club_id,ingredient_id,counted_qty::text,expected_qty::text,delta_applied::text',{count:'exact'}).eq('club_id',clubId).eq('stocktake_id',frozen.sessionId).limit(Object.keys(frozen.counts).length+1).abortSignal(operation.controller.signal);
          if(lines.error)throw new Error('stocktake_recovery_unavailable');
          return resolveStocktakeOperationReceipt(frozen,header.data,{rows:lines.data,count:lines.count});
        })(),cancelled]);
        if(!current()||operation.controller.signal.aborted)return;
        if(snapshot.status!=='found'){setRecoveryMessage('Chưa tìm thấy biên nhận khớp. Giữ yêu cầu gốc; không thể kết luận đã rollback hoặc đã chốt đúng số đếm.');return;}
        const latest=readStocktakeOperation(localStorage,actorId,clubId,backend);
        if(!latest||canonicalVoiceJson(latest.intent)!==canonicalVoiceJson(frozen))throw new Error('stocktake_recovery_changed');
        ownRequests.current.add(frozen.requestId);if(latest.state==='pending')writeStocktakeOperation(localStorage,frozen,true);
        peerChangeRef.current=false;setPeerChanged(false);refreshJournal();found=true;
      });
      await Promise.race([lookup,cancelled]);
      if(current()&&found){toast.success('Đã đối chiếu yêu cầu kiểm kho theo dữ liệu đã lưu.');void qc.invalidateQueries({queryKey:['fnb','menu',clubId]});reloadSession();}
    }catch{if(current()){setRecoveryMessage('Chưa xác minh được yêu cầu kiểm kho. Giữ mã gốc; thử đối chiếu lại khi kết nối sẵn sàng.');refreshJournal();}}
    finally{clearTimeout(timer);operation.controller.signal.removeEventListener('abort',abort);operation.controller.abort();if(recoveryWorking.current===operation){recoveryWorking.current=null;if(mounted.current)setRecovering(false);}}
  };

  const durableRecovery=journalChecked&&(journalUnavailable||durableHold||durableOperation||peerChanged) ? <div role="alert" className="space-y-2 rounded-lg border border-border p-3 text-sm">
    <p>{journalUnavailable?'Không đọc/lưu được journal kiểm kho. Chưa thể gửi lệnh.':durableOperation?`Yêu cầu ${durableOperation.kind==='open'?'mở':'chốt'} phiên chưa được đối chiếu. Không gửi lại hoặc sửa số đếm khi chưa rõ kết quả.`:durableHold?'Yêu cầu lưu số đếm chưa được đối chiếu. Chưa xác minh kết quả; không nhập lại hoặc chốt phiên này.':'Số đếm đã thay đổi ở phiên khác. Tải lại màn hình để đọc và kiểm tra lại trước khi thao tác.'}</p>
    {durableHold&&<p className="break-all text-xs">Mã yêu cầu: {durableHold.requestId} · Phiên: {durableHold.sessionId} · Nguyên liệu: {durableHold.ingredientId} · Số đếm: {durableHold.countedQty}. Cần quản lý đối chiếu kết quả trên máy chủ; tải lại không xác nhận yêu cầu đã xong.</p>}
    {durableOperation&&<p className="break-all text-xs">Mã yêu cầu: {durableOperation.requestId}{durableOperation.kind==='commit'?` · Phiên: ${durableOperation.sessionId}`:''}. Cần đối chiếu trên máy chủ; tải lại không xác nhận yêu cầu đã xong.</p>}
    {durableOperation&&<Button variant="outline" disabled={busy||recovering||journalUnavailable} onClick={()=>void recoverOperation()}>Đối chiếu yêu cầu kiểm kho</Button>}
    {recoveryMessage&&<p>{recoveryMessage}</p>}
  </div>:null;
  if(menuError||!data&&!menuLoading)return <Card role="alert" className="space-y-3 p-5"><p>Không tải được thực đơn. Chưa thể xác minh nguyên liệu để kiểm kho.</p>{durableRecovery}<Button variant="outline" onClick={()=>void reloadMenu()}>Thử tải lại thực đơn</Button></Card>;
  if(readErrorClub===clubId)return <Card role="alert" className="space-y-3 p-5"><p>Không tải được phiên kiểm kho. Chưa thể xác minh phiên và số đã đếm.</p>{durableRecovery}<Button variant="outline" onClick={reloadSession}>Thử tải lại phiên kiểm kho</Button></Card>;
  if (loading||loadedClub!==clubId||menuLoading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải…</div>
      </Card>
    );
  }

  if (!sessionId) {
    return (
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-base">Kiểm kho</h3>
          <p className="text-xs text-muted-foreground">Đếm tồn thực tế → chốt để điều chỉnh sổ kho (hao hụt/vỡ/hỏng).</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center">
          <p className="text-sm text-muted-foreground mb-3">Chưa có phiên kiểm kho đang mở.</p>
          {durableRecovery}
          <Button onClick={createSession} disabled={busy||journalUnavailable||!!durableHold||!!durableOperation||peerChanged||recovering} className="bg-success hover:bg-success/90 text-success-foreground">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ClipboardCheck className="w-4 h-4 mr-1" />}
            Tạo phiên kiểm kho
          </Button>
        </div>
      </Card>
    );
  }

  // C2: total stock-count variance in money = Σ(delta × avg_unit_cost) over counted lines.
  const totalDeltaValue = ingredients.reduce((s, i) => {
    const raw = counted[i.id];
    if (raw == null || raw.trim() === "" || !Number.isFinite(Number(raw))) return s;
    return s + (Number(raw) - i.on_hand) * i.avg_unit_cost;
  }, 0);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Kiểm kho · phiên đang mở</h3>
          <p className="text-xs text-muted-foreground">Nhập số đếm thực tế cho từng nguyên liệu, rồi “Chốt”.</p>
        </div>
        <Button onClick={commit} disabled={!commitReady||!!commitConfirmation} className="bg-success hover:bg-success/90 text-success-foreground">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
          Chốt kiểm kho
        </Button>
      </div>

      {rejectedOperation&&!durableRecovery&&<div role="alert" className="rounded-lg border border-border p-3 text-sm">Yêu cầu trước bị từ chối vì số đếm đã đổi. Kiểm tra số đếm hiện tại và xác nhận lại nếu muốn chốt.</div>}
      {durableRecovery??((lineFailureCount>0||unsavedCounts(counted,savedCounted))&&<div role="alert" className="space-y-2 rounded-lg border border-border p-3 text-sm">
        <p>Chưa xác minh toàn bộ số đếm đã lưu. Bản nháp được giữ; chưa thể chốt.</p>
        <p>{lineFailureCount>0?'Cần quản lý đối chiếu phiên kiểm kho và kết quả lưu trên máy chủ trước khi tiếp tục. Không nhập lại hoặc chốt khi chưa rõ kết quả.':'Nhập số hợp lệ rồi rời ô để lưu.'}</p>
      </div>)}

      {ingredients.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
          Chưa có nguyên liệu để kiểm.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nguyên liệu</TableHead>
                <TableHead className="text-right">Sổ (hiện tại)</TableHead>
                <TableHead className="text-right w-32">Đếm thực tế</TableHead>
                <TableHead className="text-right w-24">Lệch</TableHead>
                <TableHead className="text-right w-28">Lệch (₫)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.map((i) => {
                const raw = counted[i.id];
                const hasCount = raw != null && raw.trim() !== "" && Number.isFinite(Number(raw));
                const delta = hasCount ? Number(raw) - i.on_hand : null;
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name} <span className="text-muted-foreground text-xs">({i.stock_unit})</span></TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{i.on_hand}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingId === i.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                        <Input type="number" step="any" inputMode="decimal"
                          disabled={busy||savingId!==null||lineFailureCount>0||journalUnavailable||!!durableHold||!!durableOperation||peerChanged||recovering||!!commitConfirmation}
                          className="w-24 bg-card border-border text-foreground text-right font-mono"
                          value={raw ?? ""}
                          onChange={(e) => {if(lineWorking.current||commitWorking.current)return;draftRef.current={...draftRef.current,[i.id]:e.target.value};setCounted(draftRef.current);}}
                          onBlur={(e) => saveLine(i.id, e.target.value)} />
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-mono ${delta == null ? "text-muted-foreground" : delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-success" : "text-destructive"}`}>
                      {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${delta == null || delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-success" : "text-destructive"}`}>
                      {delta == null ? "—" : (delta > 0 ? "+" : "") + formatVND(Math.round(delta * i.avg_unit_cost))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="text-right text-xs text-muted-foreground">Tổng lệch (₫)</TableCell>
                <TableCell className={`text-right font-mono font-semibold ${totalDeltaValue === 0 ? "text-muted-foreground" : totalDeltaValue > 0 ? "text-success" : "text-destructive"}`}>
                  {(totalDeltaValue > 0 ? "+" : "") + formatVND(Math.round(totalDeltaValue))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      <AlertDialog open={!!commitConfirmation} onOpenChange={open=>{if(!open)setCommitConfirmation(null);}}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận chốt kiểm kho</AlertDialogTitle>
            <AlertDialogDescription asChild><div className="space-y-3">
              <p>Tồn kho sẽ được điều chỉnh theo số đếm đã lưu dưới đây. Kiểm tra trước khi chốt.</p>
              <ul className="space-y-1 text-foreground">
                {Object.entries(commitConfirmation?.counts??{}).map(([id,qty])=>{
                  const ingredient=ingredients.find(row=>row.id===id);
                  return <li key={id} className="break-words">{ingredient?.name??id}: {qty} {ingredient?.stock_unit??''}</li>;
                })}
              </ul>
            </div></AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Quay lại</AlertDialogCancel>
            <AlertDialogAction disabled={!commitReady} onClick={event=>{event.preventDefault();void confirmCommit();}}>Xác nhận chốt</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

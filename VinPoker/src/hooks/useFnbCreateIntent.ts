import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {fnbShiftBackend} from '@/lib/fnbShiftIntent';
import {fnbCreateOutcome} from '@/lib/fnbMutationOutcome';
import {fnbCreateJournalKey,parseFnbCreateIntent,persistFnbCreateIntent,readFnbCreateJournal,fnbCreateWrite,fnbCreateCancel,resolveFnbCreateReceipt,
 type FnbCreateIntent,type FnbCreatePayload,type FnbCreateReceipt} from '@/lib/fnbCreateIntent';
const unknown='Yêu cầu tạo đơn chưa được xác minh. Giữ mã gốc; chưa tạo đơn mới hoặc thu tiền dựa trên giỏ này.';
const rpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
/** Parent must remount on actor/credential/backend/club. Contains no bearer credentials. */
export function useFnbCreateIntent(actorId:string,clubId:string,onSettled:(i:FnbCreateIntent,o:FnbCreateReceipt,resumed:boolean)=>Promise<void>,onCancelled?:(i:FnbCreateIntent)=>void){
 const [pending,setPending]=useState<FnbCreateIntent|null>(null),[blocked,setBlocked]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
 const [readOnlyRecovery,setReadOnlyRecovery]=useState(false);
 const alive=useRef(false),writing=useRef(false),activeIntent=useRef<FnbCreateIntent|null>(null);
 const retain=(intent:FnbCreateIntent|null)=>{activeIntent.current=intent;setPending(intent);};
 let backend='';try{backend=fnbShiftBackend(import.meta.env.VITE_SUPABASE_URL);}catch{/* Invalid backend fails closed. */}
 const refresh=()=>{try{
  if(!backend||!navigator.locks?.request)throw new Error('FNB_CREATE_LOCK_UNAVAILABLE');
  const journal=readFnbCreateJournal(localStorage,actorId,clubId,backend);
  setReadOnlyRecovery(!!activeIntent.current&&(journal?.state!=='pending'||journal.intent.requestId!==activeIntent.current.requestId));
  if(activeIntent.current){
   if(journal?.state!=='pending'||journal.intent.requestId!==activeIntent.current.requestId)
    setMessage('Yêu cầu đã thay đổi ở tab khác. Đối chiếu receipt của mã gốc trước khi tạo đơn mới.');
  }else retain(journal?.state==='pending'?journal.intent:null);
  setBlocked(false);
 }catch{setBlocked(true);setMessage('Không đọc/lưu được yêu cầu tạo đơn an toàn. Chưa thể gửi thao tác mới.');}};
 useEffect(()=>{
  alive.current=true;refresh();
  const changed=(event:StorageEvent)=>{if(backend&&(event.key===null||event.key===fnbCreateJournalKey(actorId,clubId,backend)))refresh();};
  window.addEventListener('storage',changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);};
  // Scope-keyed parent fences old callbacks, including same-actor credential replacement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[actorId,clubId,backend]);
 const execute=async(mode:'submit'|'read'|'retry'|'cancel',draft?:{operation:'order'|'comp';requestId:string;payload:FnbCreatePayload})=>{
  if(!alive.current||writing.current||blocked||!backend)return;
  writing.current=true;setBusy(true);setMessage(null);
  try{return await navigator.locks.request(fnbCreateJournalKey(actorId,clubId,backend),async()=>{
   if(!alive.current)return;
   const prior=readFnbCreateJournal(localStorage,actorId,clubId,backend);
   let intent:FnbCreateIntent;
   if(mode==='submit'){
    if(activeIntent.current||prior?.state==='pending'){if(!activeIntent.current&&prior?.state==='pending')retain(prior.intent);throw new Error(unknown);}
    if(!draft)return;
    intent=parseFnbCreateIntent(JSON.stringify({actorId,clubId,backend,...draft}),actorId,clubId,backend);
   }else{const frozen=activeIntent.current??(prior?.state==='pending'?prior.intent:null);if(!frozen){refresh();return;}intent=frozen;}
   const ownsSlot=mode==='submit'||prior?.state==='pending'&&prior.intent.requestId===intent.requestId;
   if(!ownsSlot&&mode!=='read')throw new Error(unknown);
   if(ownsSlot)persistFnbCreateIntent(localStorage,intent);
   retain(intent);
   const settle=()=>{
    const current=readFnbCreateJournal(localStorage,actorId,clubId,backend);
    if(current?.intent.requestId===intent.requestId)persistFnbCreateIntent(localStorage,intent,true);
    retain(null);setMessage(null);
   };
   const read=async()=>{
    const r=await waitForManualPlayerResponse(Promise.resolve(rpc('fnb_get_create_receipt_v1',{p_club_id:clubId,p_request_id:intent.requestId,p_expected_actor:actorId})));
    return r.error?{status:'unknown'} as const:resolveFnbCreateReceipt(intent,r.data);
   };
   let resolved:ReturnType<typeof resolveFnbCreateReceipt>={status:'unknown'};
   let acknowledgement:ReturnType<typeof fnbCreateOutcome>={kind:'unknown'};
   if(mode==='read'||mode==='retry'){
    resolved=await read();if(!alive.current)return;
    if(resolved.status==='unknown')throw new Error(unknown);
    if(resolved.status==='not_found'&&mode==='read')throw new Error('Chưa tìm thấy receipt. Không thể kết luận chưa ghi; chỉ gửi lại cùng mã hoặc hủy an toàn, không tạo mã mới.');
   }
   if(mode==='submit'||mode==='retry'&&resolved.status==='not_found'){
    const call=fnbCreateWrite(intent);
    try{const response=await waitForManualPlayerResponse(Promise.resolve(rpc(call.name,call.args)));
     if(!response.error)acknowledgement=fnbCreateOutcome(response.data,intent.operation==='comp');
    }catch{/* Unknown write outcome; only read can resolve it. */}
    if(!alive.current)return;
    resolved=await read();
   }
   if(mode==='cancel'){
    try{
     const response=await waitForManualPlayerResponse(Promise.resolve(rpc('fnb_cancel_create_intent_v1',fnbCreateCancel(intent))));
     if(!alive.current)return;
     resolved=response.error?{status:'unknown'}:resolveFnbCreateReceipt(intent,response.data);
    }catch{resolved={status:'unknown'};}
    if(!alive.current)return;
    if(resolved.status==='unknown')resolved=await read();
   }
   if(!alive.current)return;
   if(resolved.status==='cancelled'){
    settle();onCancelled?.(intent);refresh();return;
   }
   if(resolved.status!=='found')throw new Error(unknown);
   const resumed=mode!=='submit'||acknowledgement.kind!=='confirmed'||acknowledgement.idempotent
    ||acknowledgement.orderId!==resolved.order.id||acknowledgement.subtotal!==null&&acknowledgement.subtotal!==resolved.order.subtotal_vnd;
   settle();
   await onSettled(intent,resolved.order,resumed);
   refresh();
   return {order:resolved.order,resumed};
  });}catch(error){if(alive.current){const text=error instanceof Error&&error.message.startsWith('Chưa tìm thấy receipt')?error.message:unknown;setMessage(text);toast.error(text);refresh();}}
  finally{writing.current=false;if(alive.current)setBusy(false);}
 };
 return {pending,blocked,busy,message,readOnlyRecovery,
  submit:(operation:'order'|'comp',requestId:string,payload:FnbCreatePayload)=>execute('submit',{operation,requestId,payload}),
  recover:()=>execute('read'),retry:()=>execute('retry'),cancel:()=>execute('cancel')};
}

import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {fnbShiftBackend,fnbShiftCancel,fnbShiftJournalKey,fnbShiftWrite,parseFnbShiftIntent,
 readFnbShiftJournal,persistFnbShiftIntent,settleFnbShiftIntent,resolveFnbShiftReceipt,resolveFnbShiftResult,
 type FnbShiftIntent,type FnbShiftResolution} from '@/lib/fnbShiftIntent';

const unknown='Yêu cầu ca chưa được xác minh. Giữ mã cũ để đối chiếu hoặc hủy an toàn.';
const rpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
/** Parent remounts on backend/actor/credential/club; no bearer or customer data is journaled. */
export function useFnbShiftIntent(actorId:string,clubId:string,onSettled:()=>Promise<void>) {
 const [pending,setPending]=useState<FnbShiftIntent|null>(null),[blocked,setBlocked]=useState(true),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState<string|null>(null);
 const alive=useRef(false),writing=useRef(false);
 let backend='';try{backend=fnbShiftBackend(import.meta.env.VITE_SUPABASE_URL);}catch{/* Fail closed on invalid config. */}
 const refreshJournal=()=>{
  try{
   if(!backend||!navigator.locks?.request)throw new Error('Browser journal locking unavailable');
   const journal=readFnbShiftJournal(localStorage,actorId,clubId,backend);
   setPending(journal?.state==='pending'?journal.intent:null);setBlocked(false);
  }catch{setBlocked(true);setMessage('Không đọc/lưu được yêu cầu ca an toàn. Chưa thể gửi thao tác mới.');}
 };
 useEffect(()=>{
  alive.current=true;refreshJournal();
  const changed=(event:StorageEvent)=>{if(backend&&(event.key===null||event.key===fnbShiftJournalKey(actorId,clubId,backend)))refreshJournal();};
  window.addEventListener('storage',changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);};
  // This hook lives in the scope-keyed panel; keep callbacks bound to that incarnation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[actorId,clubId,backend]);
 const execute=async(mode:'submit'|'read'|'retry'|'cancel',draft?:Pick<FnbShiftIntent,'operation'|'shiftId'|'amount'|'note'>)=>{
  if(!alive.current||writing.current||blocked||!backend)return;
  writing.current=true;setBusy(true);setMessage(null);
  try{
   if(!navigator.locks?.request)throw new Error('FNB_SHIFT_LOCK_UNAVAILABLE');
   await navigator.locks.request(fnbShiftJournalKey(actorId,clubId,backend),async()=>{
    if(!alive.current)return;
    const prior=readFnbShiftJournal(localStorage,actorId,clubId,backend);
    let intent:FnbShiftIntent;
    if(mode==='submit'){
     if(prior?.state==='pending'){setPending(prior.intent);throw new Error(unknown);}
     if(!draft)return;
     intent=parseFnbShiftIntent(JSON.stringify({actorId,clubId,backend,requestId:crypto.randomUUID(),...draft}),actorId,clubId,backend);
    }else{
     if(prior?.state!=='pending'){refreshJournal();return;}
     intent=prior.intent;
    }
    persistFnbShiftIntent(localStorage,intent);setPending(intent);
    const read=async()=>{
     const r=await waitForManualPlayerResponse(Promise.resolve(rpc('fnb_get_shift_intent_v1',{p_club_id:clubId,p_request_id:intent.requestId,p_expected_actor:actorId})));
     return r.error?{status:'unknown'} as const:resolveFnbShiftReceipt(intent,r.data);
    };
    let resolution:FnbShiftResolution={status:'unknown'};
    if(mode==='read'||mode==='retry'){
     resolution=await read();if(!alive.current)return;
     if(resolution.status==='unknown')throw new Error(unknown);
     if(resolution.status==='not_found'&&mode==='read')throw new Error('Chưa tìm thấy receipt; chưa thể kết luận chưa ghi. Chỉ gửi lại cùng mã hoặc hủy an toàn.');
    }
    if(mode==='submit'||mode==='cancel'||mode==='retry'&&resolution.status==='not_found'){
     try{
      const call=mode==='cancel'?{name:'fnb_cancel_shift_intent_v1',args:fnbShiftCancel(intent)}:fnbShiftWrite(intent);
      const r=await waitForManualPlayerResponse(Promise.resolve(rpc(call.name,call.args)));
      if(!alive.current)return;
      resolution=r.error?{status:'unknown'}:resolveFnbShiftResult(intent,r.data);
     }catch{resolution={status:'unknown'};}
     if(!alive.current)return;
     if(resolution.status==='unknown')resolution=await read();
    }
    if(!alive.current)return;
    if(resolution.status!=='applied'&&resolution.status!=='cancelled')throw new Error(unknown);
    await onSettled();if(!alive.current)return;
    settleFnbShiftIntent(localStorage,intent);setPending(null);setMessage(null);
    if(resolution.status==='cancelled')toast.success('Đã hủy yêu cầu; thao tác đến muộn không thể ghi.');
    else if(resolution.status==='applied'){
     if(intent.operation==='open')toast.success(resolution.alreadyOpen?'Ca đã được mở trước đó. Đã tải lại quỹ đầu ca thực tế.':'Đã đối chiếu mở ca thành công.');
     else toast.success(`Đã đối chiếu chốt ca. Chênh lệch: ${resolution.variance?.toLocaleString('vi-VN')} ₫.`);
    }
   });
  }catch(error){
   if(alive.current){const text=error instanceof Error&&(error.message===unknown||error.message.startsWith('Chưa tìm thấy receipt'))?error.message:unknown;setMessage(text);toast.error(text);refreshJournal();}
  }finally{writing.current=false;if(alive.current)setBusy(false);}
 };
 return {pending,blocked,busy,message,
  submit:(operation:'open'|'close',shiftId:string|null,amount:number)=>execute('submit',{operation,shiftId,amount,note:null}),
  recover:()=>execute('read'),retry:()=>execute('retry'),cancel:()=>execute('cancel')};
}

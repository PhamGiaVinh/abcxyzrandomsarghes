import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {fnbShiftBackend} from '@/lib/fnbShiftIntent';
import {canonicalVoiceJson} from '@/lib/trackerVoice/canonicalRequest';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {fnbStockInJournalKey,parseFnbStockInIntent,persistFnbStockInIntent,readFnbStockInJournal,
  fnbStockInWrite,resolveFnbStockInReceipt,type FnbStockInIntent,type FnbStockInPayload,type FnbStockInReceipt} from '@/lib/fnbStockInIntent';

type Reply={data:unknown;error:unknown};
type RpcBuilder=PromiseLike<Reply>&{abortSignal:(signal:AbortSignal)=>PromiseLike<Reply>};
type ReceiptQuery=RpcBuilder&{select:(columns:string)=>ReceiptQuery;eq:(column:string,value:string)=>ReceiptQuery;limit:(count:number)=>ReceiptQuery};
const rpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>RpcBuilder;
const from=supabase.from.bind(supabase) as unknown as (table:string)=>ReceiptQuery;
const unknown='Chưa xác minh được lệnh nhập kho. Giữ mã gốc; chưa tạo lệnh mới. Hãy đối chiếu receipt.';
const missingIntent='Chưa xác minh được lệnh nhập kho: đã thấy chuyển động kho nhưng thiếu nội dung yêu cầu gốc. Giữ mã lệnh và chứng từ để quản lý đối chiếu; không nhập lại giao dịch này.';
const same=(a:FnbStockInIntent,b:FnbStockInIntent)=>canonicalVoiceJson(a)===canonicalVoiceJson(b);

/** Consumer must remount on actor/credential/club/backend changes, as the other F&B intent forms do. */
export function useFnbStockInIntent(actorId:string,clubId:string,onSettled:(i:FnbStockInIntent,r:FnbStockInReceipt)=>void|Promise<void>){
  const [pending,setPending]=useState<FnbStockInIntent|null>(null),[blocked,setBlocked]=useState(true),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null),[readOnlyRecovery,setReadOnlyRecovery]=useState(false);
  const [missingIntentRequest,setMissingIntentRequest]=useState<string|null>(null);
  const active=useRef<FnbStockInIntent|null>(null),alive=useRef(false),epoch=useRef(0),working=useRef(false);
  const controllers=useRef(new Set<AbortController>());
  let backend='';try{backend=fnbShiftBackend(import.meta.env.VITE_SUPABASE_URL);}catch{/* An invalid backend cannot own a journal. */}
  const retain=(intent:FnbStockInIntent|null)=>{active.current=intent;setPending(intent);};
  const refresh=()=>{
    try{
      if(!backend||!navigator.locks?.request)throw new Error('stock_lock_unavailable');
      const journal=readFnbStockInJournal(localStorage,actorId,clubId,backend);
      const owns=!!active.current&&journal?.state==='pending'&&same(journal.intent,active.current);
      setReadOnlyRecovery(!!active.current&&!owns);
      if(!active.current)retain(journal?.state==='pending'?journal.intent:null);
      setBlocked(false);
    }catch{setBlocked(true);setMessage('Không đọc/lưu được yêu cầu nhập kho an toàn. Chưa thể gửi lệnh mới.');}
  };
  useEffect(()=>{
    alive.current=true;++epoch.current;const ownedControllers=controllers.current;refresh();
    const changed=(event:StorageEvent)=>{if(backend&&(event.key===null||event.key===fnbStockInJournalKey(actorId,clubId,backend)))refresh();};
    window.addEventListener('storage',changed);
    return()=>{alive.current=false;for(const controller of ownedControllers)controller.abort();ownedControllers.clear();window.removeEventListener('storage',changed);};
    // The consumer's scope key also retires local input drafts on credential replacement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[actorId,clubId,backend]);

  const execute=async(mode:'submit'|'read'|'retry',draft?:{requestId:string;payload:FnbStockInPayload})=>{
    if(!alive.current||working.current||blocked||!backend)return;
    const generation=epoch.current,current=()=>alive.current&&epoch.current===generation;
    working.current=true;setBusy(true);setMessage(null);
    try{return await navigator.locks.request(fnbStockInJournalKey(actorId,clubId,backend),async()=>{
      if(!current())return;
      const prior=readFnbStockInJournal(localStorage,actorId,clubId,backend);
      let intent:FnbStockInIntent;
      if(mode==='submit'){
        if(active.current||prior?.state==='pending'){if(!active.current&&prior?.state==='pending')retain(prior.intent);throw new Error(unknown);}
        if(!draft)return;
        intent=parseFnbStockInIntent(JSON.stringify({actorId,clubId,backend,...draft}),actorId,clubId,backend);
      }else{
        const frozen=active.current??(prior?.state==='pending'?prior.intent:null);
        if(!frozen){refresh();return;}intent=frozen;
      }
      const owns=mode==='submit'||prior?.state==='pending'&&same(prior.intent,intent);
      if(!owns&&mode!=='read')throw new Error(unknown);
      if(mode==='retry'&&missingIntentRequest===intent.requestId)throw new Error(missingIntent);
      if(owns)persistFnbStockInIntent(localStorage,intent);
      retain(intent);
      const read=async()=>{
        const controller=new AbortController();controllers.current.add(controller);
        try{
          const response=await observeTrackerContextRead<Reply>(from('fnb_stock_movements').select('*')
            .eq('club_id',clubId).eq('client_request_id',intent.requestId).limit(2).abortSignal(controller.signal));
          const receipt=response.error?{status:'unknown'} as const:resolveFnbStockInReceipt(intent,response.data);
          if(receipt.status==='unknown'&&'reason' in receipt&&receipt.reason==='missing_intent'){
            if(current())setMissingIntentRequest(intent.requestId);
            throw new Error(missingIntent);
          }
          return receipt;
        }catch(error){if(error instanceof Error&&error.message===missingIntent)throw error;return {status:'unknown'} as const;}
        finally{controller.abort();controllers.current.delete(controller);}
      };
      let resolved:ReturnType<typeof resolveFnbStockInReceipt>={status:'unknown'};
      if(mode==='read'||mode==='retry'){
        resolved=await read();if(!current())return;
        if(resolved.status==='unknown')throw new Error(unknown);
        if(resolved.status==='not_found'&&mode==='read')throw new Error('Chưa tìm thấy receipt; không thể kết luận chưa nhập kho. Chỉ gửi lại cùng mã gốc, không tạo mã mới.');
      }
      if(mode==='submit'||mode==='retry'&&resolved.status==='not_found'){
        const controller=new AbortController();controllers.current.add(controller);
        try{await waitForManualPlayerResponse(Promise.resolve(rpc('fnb_stock_in',fnbStockInWrite(intent)).abortSignal(controller.signal)));}
        catch{/* A failed/expired response is not proof of rollback. Only an exact receipt can settle it. */}
        finally{controller.abort();controllers.current.delete(controller);}
        if(!current())return;
        resolved=await read();
      }
      if(!current())return;
      if(resolved.status!=='found')throw new Error(unknown);
      setMissingIntentRequest(null);
      const latest=readFnbStockInJournal(localStorage,actorId,clubId,backend);
      if(latest?.state==='pending'&&same(latest.intent,intent)){
        persistFnbStockInIntent(localStorage,intent,true);retain(null);setMessage(null);
        try{await onSettled(intent,resolved.receipt);}catch{if(current())setMessage('Đã xác minh nhập kho nhưng chưa tải lại được màn hình. Không nhập lại giao dịch này.');}
      }else{
        retain(null);setMessage('Receipt mã cũ đã được xác minh; yêu cầu hiện tại không bị thay đổi.');
      }
      if(current())refresh();
      return resolved.receipt;
    });}catch(error){if(current()){setMessage(error instanceof Error&&(error.message.startsWith('Chưa tìm thấy receipt')||error.message===missingIntent)?error.message:missingIntentRequest&&missingIntentRequest===active.current?.requestId?missingIntent:unknown);refresh();}}
    finally{if(current()){working.current=false;setBusy(false);}}
  };
  return {pending,blocked,busy,message,readOnlyRecovery:readOnlyRecovery||!!pending&&pending.requestId===missingIntentRequest,
    submit:(requestId:string,payload:FnbStockInPayload)=>execute('submit',{requestId,payload}),recover:()=>execute('read'),retry:()=>execute('retry')};
}

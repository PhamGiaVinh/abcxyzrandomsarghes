import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {parseSePayJournal,parseSePayReceipt,saveSePayJournal,sepayIntentArgs,sepayJournalKey,sepayRejectionMessage,
 type SePayIntent,type SePayResult} from '@/lib/sepaySettlementIntent';

type IntentInput=Omit<SePayIntent,'actorId'|'requestId'|'resolved'>;
const UNKNOWN='Chưa xác minh được kết quả. Giữ nguyên yêu cầu và tra cứu trước khi thao tác tiếp.';
function restore(actorId:string):{pending:SePayIntent|null;error:boolean}{
 try{const raw=sessionStorage.getItem(sepayJournalKey(actorId));
  const saved=raw===null?null:parseSePayJournal(raw,actorId);return {pending:saved?.resolved?null:saved,error:false};
 }catch{return {pending:null,error:true};}
}
export function useSePaySettlementIntent(actorId:string,onResolved:()=>void){
 const [journal,setJournal]=useState(()=>restore(actorId));
 const [busy,setBusy]=useState(false),[missing,setMissing]=useState(false),[notice,setNotice]=useState('');
 const flight=useRef(false),alive=useRef(false),pendingRef=useRef(journal.pending),resolved=useRef(onResolved);
 resolved.current=onResolved;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const finish=(i:SePayIntent,result:Exclude<SePayResult,{status:'missing'}>)=>{
  saveSePayJournal(sessionStorage,sepayJournalKey(actorId),{...i,resolved:true});
  pendingRef.current=null;setJournal({pending:null,error:false});setMissing(false);setNotice('');
  const surplusNotice='surplus' in result&&result.surplus>0?` Có tiền dư ${result.surplus.toLocaleString('vi-VN')}đ cần đối soát.`:'';
  if(result.status==='rejected')toast.error(sepayRejectionMessage(result.error));
  else if(result.status==='ignored')toast.success('Đã bỏ qua giao dịch.');
  else if(result.status==='seated')toast.success(result.surplus>0?'Đã xác nhận và xếp ghế; có tiền dư cần đối soát.':'Đã xác nhận — ghế đã được xếp.');
  else if(result.status==='partial')toast.success(`Đã ghi nhận tiền một phần; còn thiếu ${result.remaining.toLocaleString('vi-VN')}đ. Chưa xếp ghế.`);
  else if(result.status==='waiting')toast.success('Đã nhận đủ tiền — đang chờ bàn/ghế. Không thu lại tiền.'+surplusNotice);
  else toast.error('Đã ghi nhận tiền nhưng xếp ghế cần xử lý. Không thu lại tiền.'+surplusNotice);
  resolved.current();
 };
 const run=async(i:SePayIntent,mode:'commit'|'receipt')=>{
  if(flight.current||!alive.current)return;
  flight.current=true;setBusy(true);setMissing(false);
  try{
   const client=supabase as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
   const {data,error}=await waitForManualPlayerResponse(Promise.resolve(client.rpc('cashier_sepay_intent_v1',sepayIntentArgs(i,mode))));
   if(!alive.current)return;
   if(error)throw Error('SEPAY_TRANSPORT_UNKNOWN');
   const result=parseSePayReceipt(data,i);
   if(result.status==='missing'){
    setMissing(true);setNotice('Chưa tìm thấy receipt. Chỉ được thử lại đúng yêu cầu đang giữ, không tạo khoản mới.');
   }else finish(i,result);
  }catch{if(alive.current){setNotice(UNKNOWN);toast.error(UNKNOWN);}}
  finally{flight.current=false;if(alive.current)setBusy(false);}
 };
 const start=async(input:IntentInput)=>{
  if(flight.current||pendingRef.current||journal.error||!alive.current)return;
  const i:SePayIntent={...input,actorId,requestId:crypto.randomUUID()};
  try{saveSePayJournal(sessionStorage,sepayJournalKey(actorId),i);}
  catch{setJournal({pending:null,error:true});toast.error('Không lưu được yêu cầu an toàn. Chưa gửi thao tác.');return;}
  pendingRef.current=i;setJournal({pending:i,error:false});setNotice('Đang xác minh yêu cầu.');await run(i,'commit');
 };
 return {pending:journal.pending,journalError:journal.error,busy,missing,notice,start,
  recover:()=>pendingRef.current?run(pendingRef.current,'receipt'):Promise.resolve(),
  retry:()=>missing&&pendingRef.current?run(pendingRef.current,'commit'):Promise.resolve()};
}

import {useEffect,useId,useRef,useState} from 'react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {chipOpsRpcErrorMessage} from '@/lib/chipOpsErrors';
import type {AcquireChipSetupWrite} from '@/lib/chipSetupWriteGate';
import {clearChipSetCreationIntent,parseChipSetCreationReceipt,persistChipSetCreationIntent,readChipSetCreationIntent,
 type ChipSetCreationIntent,type ChipSetCreationScope} from '@/lib/chipSetCreationIntent';

type Props={scope:ChipSetCreationScope|null;bound:boolean;busy:boolean;setBusy:(v:boolean)=>void;onPendingChange:(v:boolean)=>void;onCommitted:()=>void;acquireWrite?:AcquireChipSetupWrite};
type RpcName='chip_ops_create_and_bind_set_v1'|'get_chip_setup_create_bind_receipt_v1'|'cancel_chip_setup_create_bind_v1';
const sdk=supabase as unknown as {rpc:(name:RpcName,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
const unknownOutcome='Chưa xác minh được kết quả tạo bộ chip. Giữ nguyên yêu cầu; hãy đối chiếu trước khi tạo yêu cầu mới.';
const storageFailure='Không đọc hoặc lưu được yêu cầu tạo bộ chip. Chưa gửi lệnh mới; hãy kiểm tra bộ nhớ trình duyệt rồi đọc lại.';

export function CreateChipSetControl({scope,bound,busy,setBusy,onPendingChange,onCommitted,acquireWrite}:Props){
 const scopeKey=JSON.stringify(scope),fieldId=useId();
 const current=useRef({key:scopeKey});if(current.current.key!==scopeKey)current.current={key:scopeKey};
 const mounted=useRef(false),flight=useRef<{release:()=>void}|null>(null);
 const callbacks=useRef({setBusy,onPendingChange,onCommitted,busy});callbacks.current={setBusy,onPendingChange,onCommitted,busy};
 const [draft,setDraft]=useState({key:scopeKey,value:''});
 const [state,setState]=useState<{key:string;ready:boolean;pending:ChipSetCreationIntent|null;error:string|null;working:boolean}>
  ({key:scopeKey,ready:false,pending:null,error:null,working:false});
 const visible=state.key===scopeKey?state:{key:scopeKey,ready:false,pending:null,error:null,working:false};
 const isCurrent=(token:object)=>mounted.current&&current.current===token;
 const update=(token:object,pending:ChipSetCreationIntent|null,error:string|null,working=false)=>{
  if(!isCurrent(token))return;
  setState({key:scopeKey,ready:true,pending,error,working});callbacks.current.onPendingChange(!!pending||!!error);
 };
 const execute=async(mode:'create'|'lookup'|'cancel',token:object,intent?:ChipSetCreationIntent)=>{
  if(!scope||!isCurrent(token)||flight.current||callbacks.current.busy)return;
  const release=acquireWrite?.();if(acquireWrite&&!release)return;
  const capturedSetBusy=callbacks.current.setBusy;
  const ownFlight={release:release??(()=>capturedSetBusy(false))};flight.current=ownFlight;
  let activeIntent=intent;
  try{
   activeIntent??=persistChipSetCreationIntent(window.sessionStorage,scope,draft.key===scopeKey?draft.value:'');
   update(token,activeIntent,null,true);if(!acquireWrite)callbacks.current.setBusy(true);
   const args={p_tournament_id:activeIntent.tournamentId,p_name:activeIntent.name,p_request_id:activeIntent.requestId,p_expected_actor:activeIntent.actorId};
   const request=Promise.resolve(sdk.rpc(mode==='create'?'chip_ops_create_and_bind_set_v1':mode==='lookup'?'get_chip_setup_create_bind_receipt_v1':'cancel_chip_setup_create_bind_v1',args));
   const {data,error}=await(mode==='lookup'?observeTrackerContextRead(request):waitForManualPlayerResponse(request));
   if(!isCurrent(token))return;
   if(error)throw error;
   if(data===null&&mode==='lookup'){update(token,activeIntent,unknownOutcome);return;}
   const receipt=parseChipSetCreationReceipt(data,activeIntent);
   clearChipSetCreationIntent(window.sessionStorage,activeIntent,receipt);
   update(token,null,null);setDraft({key:scopeKey,value:''});
   if(receipt.outcome==='created_bound')toast.success('Đã tạo & gán bộ chip.');
   else if(receipt.outcome==='cancelled')toast.success('Đã hủy yêu cầu chưa thực hiện.');
   else toast.error(receipt.error==='NAME_EXISTS'?'Tên bộ chip đã tồn tại. Hãy gán bộ có sẵn hoặc chọn tên khác.':
    receipt.error==='CHIP_SET_ALREADY_BOUND_RELOAD'?'Giải đã được gán bộ chip. Đang đọc lại dữ liệu.':'Yêu cầu tạo bộ chip bị từ chối: '+receipt.error);
   if(receipt.outcome!=='cancelled')callbacks.current.onCommitted();
  }catch(error){
   if(!isCurrent(token))return;
   const message=activeIntent?unknownOutcome:storageFailure;
   update(token,activeIntent??null,message);
   toast.error(activeIntent&&error&&typeof error==='object'&&('code' in error||error instanceof TypeError)?chipOpsRpcErrorMessage(error):message);
  }finally{
   if(flight.current===ownFlight)flight.current=null;
   ownFlight.release();
   if(isCurrent(token)){setState(old=>old.key===scopeKey?{...old,working:false}:old);}
  }
 };
 const hydrate=()=>{
  const token=current.current;
  if(!scope||!isCurrent(token)||flight.current)return;
  try{
   const pending=readChipSetCreationIntent(window.sessionStorage,scope);update(token,pending,null);
   if(pending){setDraft({key:scopeKey,value:pending.name});void execute('lookup',token,pending);}
  }catch{update(token,null,storageFailure);}
 };
 const hydrateRef=useRef(hydrate);hydrateRef.current=hydrate;
 useEffect(()=>{
  mounted.current=true;hydrateRef.current();const captured=callbacks.current;
  return()=>{const owned=flight.current;mounted.current=false;current.current={key:current.current.key};flight.current=null;owned?.release();captured.onPendingChange(false);};
 },[scopeKey]);

 if(bound&&!visible.pending&&!visible.error&&visible.ready)return null;
 return <div className="space-y-3">
  {visible.error&&<p role="alert" className="text-sm text-warning">{visible.error}</p>}
  {visible.pending?<div className="space-y-2 rounded-lg border border-warning/30 p-3">
    <p className="text-sm">Yêu cầu đang chờ: {visible.pending.name}</p>
    <div className="flex flex-wrap gap-2">
     <Button variant="outline" disabled={busy||visible.working} onClick={()=>void execute('lookup',current.current,visible.pending!)}>Đối chiếu yêu cầu</Button>
     <Button variant="outline" disabled={busy||visible.working} onClick={()=>void execute('create',current.current,visible.pending!)}>Gửi lại nguyên yêu cầu</Button>
     <Button variant="outline" disabled={busy||visible.working} onClick={()=>void execute('cancel',current.current,visible.pending!)}>Hủy yêu cầu chưa thực hiện</Button>
    </div>
   </div>:!bound?<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
    <div className="flex-1"><Label htmlFor={fieldId} className="text-xs">Tạo bộ chip mới</Label>
     <Input id={fieldId} value={draft.key===scopeKey?draft.value:''} disabled={busy||!visible.ready||!!visible.error}
      onChange={e=>setDraft({key:scopeKey,value:e.target.value})} placeholder="VD: Bộ chip giải A"/></div>
    <Button disabled={busy||!visible.ready||!!visible.error||!(draft.key===scopeKey&&draft.value.trim())} onClick={()=>void execute('create',current.current)}>Tạo & gán</Button>
   </div>:null}
  {!visible.pending&&visible.error&&<Button variant="outline" disabled={busy||visible.working} onClick={hydrate}>Đọc lại yêu cầu</Button>}
 </div>;
}

import {useEffect,useId,useRef,useState} from 'react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import type {AcquireChipSetupWrite} from '@/lib/chipSetupWriteGate';
import {chipTemplateSaveArgs,clearChipTemplateSaveIntent,parseChipTemplateSaveReceipt,persistChipTemplateSaveIntent,readChipTemplateSaveIntent,
 type ChipTemplateSaveIntent,type ChipTemplateSaveScope} from '@/lib/chipTemplateSaveIntent';

type Props={scope:ChipTemplateSaveScope|null;chipSetId:string|null;denoms:{id:string;value:number;color:string|null}[];
 busy:boolean;acquireWrite:AcquireChipSetupWrite;onPendingChange:(pending:boolean)=>void;onCommitted:()=>void};
const unknownOutcome='Chưa xác minh được kết quả lưu mẫu stack. Giữ nguyên yêu cầu và đối chiếu trước khi lưu mẫu khác.';
const storageFailure='Không đọc hoặc lưu được yêu cầu mẫu stack. Chưa gửi lệnh mới; hãy kiểm tra bộ nhớ trình duyệt rồi đọc lại.';
const sdk=supabase as unknown as {rpc:(name:string,args:ReturnType<typeof chipTemplateSaveArgs>)=>PromiseLike<{data:unknown;error:unknown}>};
const fmt=(n:number)=>n.toLocaleString('vi-VN');

export function TemplateSaveControl(props:Props){
 return <ScopedTemplateSaveControl key={JSON.stringify(props.scope)} {...props}/>;
}
function ScopedTemplateSaveControl({scope,chipSetId,denoms,busy,acquireWrite,onPendingChange,onCommitted}:Props){
 const id=useId(),alive=useRef(false),flight=useRef<{release:()=>void}|null>(null);
 const lifetime=useRef<object>({});
 const callbacks=useRef({busy,acquireWrite,onPendingChange,onCommitted});callbacks.current={busy,acquireWrite,onPendingChange,onCommitted};
 const [name,setName]=useState(''),[stackValue,setStackValue]=useState(''),[counts,setCounts]=useState<Record<string,string>>({});
 const [state,setState]=useState<{ready:boolean;pending:ChipTemplateSaveIntent|null;error:string|null;working:boolean}>({ready:false,pending:null,error:null,working:false});
 const update=(pending:ChipTemplateSaveIntent|null,error:string|null,working=false)=>{
  if(!alive.current)return;setState({ready:true,pending,error,working});callbacks.current.onPendingChange(!!pending||!!error);
 };
 const target=Number(stackValue),liveSum=denoms.reduce((sum,d)=>sum+(Number(counts[d.id])||0)*d.value,0);
 const validCounts=denoms.every(d=>!counts[d.id]||(Number.isInteger(Number(counts[d.id]))&&Number(counts[d.id])>=0&&Number(counts[d.id])<=2147483647));
 const lines=denoms.filter(d=>Number(counts[d.id])>0).map(d=>({denomination_id:d.id,count:Number(counts[d.id])}));
 const canSave=!!scope&&!!chipSetId&&!!name.trim()&&Number.isSafeInteger(target)&&target>0&&validCounts&&lines.length>0&&Number.isSafeInteger(liveSum)&&liveSum===target;
 const execute=async(mode:'save'|'lookup'|'cancel',retained?:ChipTemplateSaveIntent)=>{
  if(!scope||!alive.current||flight.current||callbacks.current.busy||(!retained&&!canSave))return;
  const release=callbacks.current.acquireWrite();if(!release)return;
  const token=lifetime.current,isCurrent=()=>alive.current&&lifetime.current===token;
  const owned={release};flight.current=owned;let intent=retained;
  try{
   intent??=persistChipTemplateSaveIntent(window.sessionStorage,scope,{chipSetId:chipSetId!,name,stackValue:target,lines});
   update(intent,null,true);
   const request=Promise.resolve(sdk.rpc(mode==='save'?'chip_ops_save_stack_template_v2':mode==='lookup'?'get_chip_template_save_receipt_v1':'cancel_chip_template_save_v1',chipTemplateSaveArgs(intent)));
   const {data,error}=await(mode==='lookup'?observeTrackerContextRead(request):waitForManualPlayerResponse(request));
   if(!isCurrent())return;if(error)throw error;
   if(data===null&&mode==='lookup'){update(intent,unknownOutcome);return;}
   const receipt=parseChipTemplateSaveReceipt(data,intent);
   clearChipTemplateSaveIntent(window.sessionStorage,intent,receipt);
   update(null,null);setName('');setStackValue('');setCounts({});
   if(receipt.outcome==='saved')toast.success('Đã lưu mẫu stack.');
   else if(receipt.outcome==='cancelled')toast.success('Đã hủy yêu cầu lưu mẫu chưa thực hiện.');
   else toast.error(receipt.error==='NAME_EXISTS'?'Tên mẫu đã tồn tại. Hãy kiểm tra mẫu đã lưu hoặc chọn tên khác.':'Yêu cầu lưu mẫu bị từ chối: '+receipt.error);
   if(receipt.outcome!=='cancelled')callbacks.current.onCommitted();
  }catch{
   if(isCurrent()){update(intent??null,intent?unknownOutcome:storageFailure);toast.error(intent?unknownOutcome:storageFailure);}
  }finally{
   if(flight.current===owned)flight.current=null;owned.release();
   if(isCurrent())setState(old=>({...old,working:false}));
  }
 };
 const hydrate=()=>{
  if(!scope||!alive.current||flight.current)return;
  try{
   const pending=readChipTemplateSaveIntent(window.sessionStorage,scope);update(pending,null);
   if(pending)void execute('lookup',pending);
  }catch{update(null,storageFailure);}
 };
 const hydrateRef=useRef(hydrate);hydrateRef.current=hydrate;
 useEffect(()=>{
  alive.current=true;hydrateRef.current();const captured=callbacks.current;
  return()=>{alive.current=false;lifetime.current={};const owned=flight.current;flight.current=null;owned?.release();captured.onPendingChange(false);};
 },[]);
 const disabled=busy||!state.ready||!!state.pending||!!state.error;
 return <div className="space-y-3 border-t border-border pt-3">
  {state.error&&<p role="alert" className="text-sm text-warning">{state.error}</p>}
  {state.pending?<div className="space-y-2 rounded-lg border border-warning/30 p-3">
   <p className="text-sm">Yêu cầu mẫu stack đang chờ: {state.pending.name} · {fmt(state.pending.stackValue)}</p>
   <div className="flex flex-wrap gap-2">
    <Button variant="outline" disabled={busy||state.working} onClick={()=>void execute('lookup',state.pending!)}>Đối chiếu mẫu stack</Button>
    <Button variant="outline" disabled={busy||state.working} onClick={()=>void execute('save',state.pending!)}>Gửi lại nguyên mẫu stack</Button>
    <Button variant="outline" disabled={busy||state.working} onClick={()=>void execute('cancel',state.pending!)}>Hủy yêu cầu lưu mẫu</Button>
   </div>
  </div>:<>
   <div className="flex flex-col gap-2 sm:flex-row">
    <div className="flex-1"><Label htmlFor={id+'-name'} className="text-xs">Tên mẫu</Label><Input id={id+'-name'} disabled={disabled} value={name} onChange={e=>setName(e.target.value)} placeholder="VD: 30K mix"/></div>
    <div className="flex-1"><Label htmlFor={id+'-stack'} className="text-xs">Giá trị stack</Label><Input id={id+'-stack'} disabled={disabled} type="number" inputMode="numeric" value={stackValue} onChange={e=>setStackValue(e.target.value)} placeholder="VD: 30000"/></div>
   </div>
   <div><Label className="text-xs">Số chip mỗi mệnh giá</Label><div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
    {denoms.map(d=><div key={d.id} className="flex items-center gap-2">
     <span className="inline-block h-3.5 w-3.5 rounded-full border border-border" style={{backgroundColor:d.color??'transparent'}} aria-hidden/>
     <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{fmt(d.value)}</span>
     <Input disabled={disabled} type="number" inputMode="numeric" min={0} aria-label={'Số chip '+fmt(d.value)} value={counts[d.id]??''} onChange={e=>setCounts(old=>({...old,[d.id]:e.target.value}))} placeholder="0" className="h-9"/>
    </div>)}
   </div></div>
   <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
    <span className="text-muted-foreground">Tổng đang nhập: <span className="font-semibold tabular-nums">{fmt(liveSum)}</span>{target>0&&' / '+fmt(target)}</span>
    <Button disabled={disabled||!canSave} onClick={()=>void execute('save')}>Lưu mẫu</Button>
   </div>
   {target>0&&lines.length>0&&liveSum!==target&&<p className="text-xs text-warning">Tổng chip ({fmt(liveSum)}) phải bằng đúng giá trị stack ({fmt(target)}) mới lưu được.</p>}
   {!chipSetId&&<p className="text-xs text-muted-foreground">Gán bộ chip trước khi lưu mẫu stack.</p>}
  </>}
  {!state.pending&&state.error&&<Button variant="outline" disabled={busy||state.working} onClick={hydrate}>Đọc lại yêu cầu mẫu stack</Button>}
 </div>;
}

// DEV-only harness. Actual planning modal/recovery hook/canonical Floor client;
// not a replacement for full DealerSwingTab layout or hosted Auth/Realtime.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import ChangePredictedDealerModal from '@/components/cashier/ChangePredictedDealerModal';
import {useManualSwingRecovery} from '@/components/cashier/dealer-swing/useManualSwingRecovery';
import type {DealerAttendance} from '@/hooks/useDealerSwing';
import {createFloorTableControlV3Client,type FloorTableControlV3Rpc} from '@/lib/floorTableControlV3';
import {Button} from '@/components/ui/button';
type Manifest={actor:string;club:string;dealerPlan:{table:string;session:string;assignment:string}};
type State={session:{id:string;revision:number;closed:boolean};assignment:{id:string;table_id:string;table_session_id:string;version:number;attendance_id:string;swing_due_at:string|null}|null;dealers:DealerAttendance[]};
const rpc=(name:string,args:Record<string,unknown>)=>(supabase as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>}).rpc(name,args);
export function DealerPlanNativePreview({manifest}:{manifest:Manifest}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[planConfirmed,setPlanConfirmed]=useState(false),[closing,setClosing]=useState(false);
 const life=useRef(0),closeFlight=useRef(false),closeKey=useRef<string|null>(null);
 const read=useCallback(async()=>{
  const generation=life.current;setError('');
  try{const {data}=await supabase.auth.getSession();const response=await fetch('http://127.0.0.1:54329/__local/dealer-state',{headers:{authorization:`Bearer ${data.session?.access_token??''}`}});
   if(!response.ok)throw new Error('Không đọc được trạng thái canary.');const next=await response.json() as State;
   if(next.session?.id!==manifest.dealerPlan.session||!Array.isArray(next.dealers))throw new Error('Sai scope canary.');
   if(life.current===generation)setState(next);
  }catch{if(life.current===generation)setError('Không xác minh được trạng thái bàn TEST.');}
 },[manifest.dealerPlan.session]);
 useEffect(()=>{const generation=++life.current;void read();return()=>{life.current=generation+1;};},[read]);
 const recovery=useManualSwingRecovery({actorId:manifest.actor,clubId:manifest.club,assignments:state?.assignment?[state.assignment]:[],rpc,onSettled:read});
 const floor=useMemo(()=>createFloorTableControlV3Client(rpc as FloorTableControlV3Rpc),[]);
 const close=async()=>{
  if(!state||state.session.closed||recovery.pending||closeFlight.current)return;
  closeFlight.current=true;setClosing(true);closeKey.current??=crypto.randomUUID();
  try{const result=await floor.closeClubTable({tableSessionId:state.session.id,expectedRevision:state.session.revision,requestId:closeKey.current});
   if(!result.ok)throw new Error('Close rejected');await read();
  }catch{setError('Chưa xác minh được đóng bàn TEST.');}finally{closeFlight.current=false;setClosing(false);}
 };
 return <main className="mx-auto max-w-xl space-y-4 p-4 text-foreground">
  <h1 className="text-xl font-semibold">Dealer plan → Swing → close · local TEST</h1>
  <p className="text-sm">Actual product modal, recovery hook and Floor RPC client. Local Auth/HTTP adapter; real PostgreSQL commits. Auto OFF.</p>
  {error&&<p role="alert">{error}</p>}
  <Button variant="outline" onClick={()=>void read()}>Tải lại bàn TEST</Button>
  {state?<>
   <p role="status">Phiên bàn: {state.session.closed?'Đã đóng':'Đang mở'} · revision {state.session.revision}</p>
   <p className="break-all text-xs">Session: {state.session.id}</p>
   <p>Dealer hiện tại: {state.dealers.find(d=>d.id===state.assignment?.attendance_id)?.dealers?.full_name??'Không còn assignment'}</p>
   <div className="flex flex-wrap gap-2">
    <Button disabled={!state.assignment||state.session.closed||!!recovery.pending||closing} onClick={()=>setOpen(true)}>Đổi dự kiến TEST</Button>
    <Button disabled={!state.assignment||!planConfirmed||!!recovery.pending||!!recovery.swingingTableId||closing} onClick={()=>{if(state.assignment)void recovery.performSwingForTable(state.assignment.id);}}>Swing TEST</Button>
    <Button disabled={state.session.closed||!!recovery.pending||closing} onClick={()=>void close()}>Đóng bàn TEST</Button>
   </div>
   {recovery.error&&<p role="alert">{recovery.error}</p>}
   {recovery.pending&&<div className="space-y-2 rounded-lg border p-3"><p className="break-all text-xs">Yêu cầu Swing: {recovery.pending.request_id}</p>
    <Button disabled={!!recovery.swingingTableId} onClick={()=>void recovery.reconcile()}>Đối chiếu Swing TEST</Button></div>}
   {state.assignment&&<ChangePredictedDealerModal open={open} onOpenChange={setOpen} tableName="Cash session TEST"
    context={{actorId:manifest.actor,clubId:manifest.club,sessionId:state.session.id,assignmentId:state.assignment.id,version:state.assignment.version,swingDueAt:state.assignment.swing_due_at}}
    slot0={null} currentTableAttendanceId={state.assignment.attendance_id} dealers={state.dealers} assignedTableNameByAttendanceId={{}} restMinutes={15}
    onChanged={()=>{setPlanConfirmed(true);void read();}}/>}
  </>:<p>Đang đọc canary…</p>}
 </main>;
}

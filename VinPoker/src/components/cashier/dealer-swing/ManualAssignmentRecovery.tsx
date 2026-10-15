import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {waitForManualPlayerResponse} from "@/lib/floorManualPlayerIntent";
import {assertInitialAssignmentIntent,clearInitialAssignmentIntent,initialAssignmentKey,initialAssignmentReceipt,listInitialAssignmentIntents,
  type InitialAssignmentIntent} from "@/lib/dealerInitialAssignmentIntent";

type Props={actorId:string;clubId:string;revision:number;blocked:boolean;
  invoke:(body:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>;
  onSettled:(intent:InitialAssignmentIntent)=>unknown;};
export function ManualAssignmentRecovery(props:Props){
  return <RecoverySession key={JSON.stringify([props.actorId,props.clubId])} {...props}/>;
}
function RecoverySession({actorId,clubId,revision,blocked,invoke,onSettled}:Props){
  const [intents,setIntents]=useState<InitialAssignmentIntent[]>([]),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[retryKey,setRetryKey]=useState<string|null>(null);
  const alive=useRef(true),flight=useRef(false),latest=useRef({blocked,onSettled});latest.current={blocked,onSettled};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const reload=()=>{
    try{setIntents(listInitialAssignmentIntents(sessionStorage,actorId,clubId));setError("");setRetryKey(null);}
    catch(e){setError(e instanceof Error?e.message:"Không đọc được journal gán dealer.");setRetryKey(null);}
  };
  useEffect(()=>{
    try{setIntents(listInitialAssignmentIntents(sessionStorage,actorId,clubId));setError("");setRetryKey(null);}
    catch(e){setError(e instanceof Error?e.message:"Không đọc được journal gán dealer.");setRetryKey(null);}
  },[actorId,clubId,revision]);
  const reconcile=async(i:InitialAssignmentIntent,retry=false)=>{
    if(flight.current||latest.current.blocked)return;
    flight.current=true;setBusy(true);setRetryKey(null);
    try{
      const read=async()=>{
        assertInitialAssignmentIntent(sessionStorage,i);
        const r=await waitForManualPlayerResponse(Promise.resolve(invoke({...i,mode:"receipt"})),10000);
        if(!alive.current)return "unknown" as const;
        assertInitialAssignmentIntent(sessionStorage,i);
        if(r.error)throw new Error(r.error.message);
        return initialAssignmentReceipt(r.data,i);
      };
      let status=await read();if(!alive.current)return;
      if(retry&&status==="not_found"){
        assertInitialAssignmentIntent(sessionStorage,i);
        const r=await waitForManualPlayerResponse(Promise.resolve(invoke({...i,mode:"assign",requested_by:i.expected_actor_id})));
        if(!alive.current)return;
        if(r.error)throw new Error(r.error.message);
        status=await read();if(!alive.current)return;
      }
      if(status!=="found"){
        setError("Chưa có kết quả xác nhận. Giữ nguyên request; không tự gán lại hoặc bỏ journal.");
        if(status==="not_found")setRetryKey(initialAssignmentKey(i));
        return;
      }
      clearInitialAssignmentIntent(sessionStorage,i);reload();
      try{await waitForManualPlayerResponse(Promise.resolve(latest.current.onSettled(i)),10000);}
      catch{if(alive.current)setError("Đã đối chiếu thành công nhưng chưa tải lại được danh sách bàn.");}
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:"Không xác minh được kết quả gán.");}
    finally{if(alive.current){flight.current=false;setBusy(false);}}
  };
  if(!intents.length&&!error)return null;
  return <section aria-label="Phục hồi yêu cầu gán dealer" className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
    <p className="text-sm">Còn yêu cầu gán dealer chưa được đối chiếu. Không tạo yêu cầu khác trước khi xác minh.</p>
    {error&&<p role="status" className="text-sm">{error}</p>}
    {intents.map(i=><div key={initialAssignmentKey(i)} className="space-y-2">
      <p className="text-xs text-muted-foreground break-all">Bàn {i.table_id} · Phiên {i.table_session_id} · Request {i.idempotency_key}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy||blocked} onClick={()=>void reconcile(i)}>Đối chiếu yêu cầu gán</Button>
        {retryKey===initialAssignmentKey(i)&&<Button size="sm" disabled={busy||blocked} onClick={()=>void reconcile(i,true)}>Gửi lại đúng yêu cầu gán</Button>}
      </div>
    </div>)}
    <Button size="sm" variant="outline" disabled={busy||blocked} onClick={reload}>Đọc lại journal gán</Button>
  </section>;
}

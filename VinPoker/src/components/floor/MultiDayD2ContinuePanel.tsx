import {useEffect,useRef,useState} from 'react';
import {useSupabaseClient} from '@/integrations/supabase/SupabaseClientContext';
import {useTournamentRedrawTv} from '@/hooks/useTournamentRedrawTv';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {Button} from '@/components/ui/button';

type Intent={actorId:string;tournamentId:string;batchId:string;revision:number;requestId:string};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
type ContinueProps={actorId:string;tournamentId:string;disabled?:boolean;onContinued?:()=>void};
export function MultiDayD2ContinuePanel(props:ContinueProps) {
 return <ScopedD2ContinuePanel key={`${props.actorId}:${props.tournamentId}`} {...props}/>;
}
function ScopedD2ContinuePanel({actorId,tournamentId,disabled=false,onContinued}:ContinueProps) {
 const client=useSupabaseClient(),tv=useTournamentRedrawTv(tournamentId,true);
 const key=`vinpoker:d2-continue:v1:${actorId}:${tournamentId}`;
 const [pending,setPending]=useState<Intent|null>(null),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
 const [error,setError]=useState<string|null>(null),[done,setDone]=useState<string|null>(null);
 const raw=useRef<string|null>(null),alive=useRef(true),working=useRef(false);
 useEffect(()=>{
  alive.current=true;
  try {
   raw.current=sessionStorage.getItem(key);
   if(raw.current){
    const p:unknown=JSON.parse(raw.current);
    if(!object(p)||p.actorId!==actorId||p.tournamentId!==tournamentId||!uuid(p.batchId)||!uuid(p.requestId)
     ||typeof p.revision!=='number'||!Number.isSafeInteger(p.revision)||p.revision<1)throw new Error('D2_CONTINUE_INTENT_INVALID');
    setPending(p as Intent);
   }
  } catch {setBlocked(true);setError('Không đọc được yêu cầu Continue đã lưu. Chưa được gửi thao tác mới.');}
  return()=>{alive.current=false;};
 },[actorId,key,tournamentId]);
 const proceed=async()=>{
  if(working.current||disabled||blocked||!alive.current)return;
  const intent=pending??(tv.state==='ready'&&tv.data?.kind==='initial_d2'?{
   actorId,tournamentId,batchId:tv.data.batchId,revision:tv.data.redrawRevision,requestId:crypto.randomUUID()}:null);
  if(!intent)return;
  working.current=true;setBusy(true);setError(null);
  try {
   if(sessionStorage.getItem(key)!==raw.current)throw new Error('D2_CONTINUE_JOURNAL_CHANGED');
   const encoded=JSON.stringify(intent);sessionStorage.setItem(key,encoded);
   if(sessionStorage.getItem(key)!==encoded)throw new Error('D2_CONTINUE_JOURNAL_SAVE_FAILED');
   raw.current=encoded;setPending(intent);
   const response=await waitForManualPlayerResponse(Promise.resolve((client as unknown as {
    rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
   }).rpc('floor_continue_tournament_redraw_v1',{p_batch_id:intent.batchId,p_expected_redraw_revision:intent.revision,p_request_id:intent.requestId})));
   if(!alive.current)return;
   const value=response.data;
   if(response.error||!object(value)||value.ok!==true||value.batch_id!==intent.batchId
    ||value.redraw_revision!==intent.revision+1||typeof value.clock_resumed!=='boolean')throw new Error('D2_CONTINUE_OUTCOME_UNKNOWN');
   if(sessionStorage.getItem(key)!==raw.current)throw new Error('D2_CONTINUE_JOURNAL_CHANGED');
   sessionStorage.removeItem(key);
   if(sessionStorage.getItem(key)!==null)throw new Error('D2_CONTINUE_JOURNAL_CLEAR_FAILED');
   raw.current=null;setPending(null);setDone(intent.batchId);onContinued?.();await tv.refresh();
  } catch {if(alive.current)setError('Chưa xác minh Continue. Giữ nguyên request ID và thử lại để đọc kết quả idempotent từ server.');}
  finally {working.current=false;if(alive.current)setBusy(false);}
 };
 const active=tv.data?.kind==='initial_d2'&&tv.data.batchId!==done;
 if(!active&&!pending&&!error&&!done&&tv.state!=='error'&&tv.state!=='stale')return null;
 return <div className="space-y-2 rounded border border-border p-3 text-sm" aria-label="Tiếp tục D2">
  {active&&<p>D2 đang giữ bàn để hiển thị sơ đồ ghế. Xác nhận sau khi người chơi đã vào chỗ.</p>}
  {pending&&<p role="status">Có yêu cầu Continue chưa xác minh; không tạo mã mới.</p>}
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  {(tv.state==='error'||tv.state==='stale')&&<p role="alert">Chưa xác minh được trạng thái hold D2. Không gửi Continue mới từ dữ liệu cũ.</p>}
  {done&&<p role="status">Đã kết thúc hiển thị xếp ghế D2 theo receipt máy chủ.</p>}
  {(active||pending)&&<Button disabled={disabled||busy||blocked||(!pending&&tv.state!=='ready')} onClick={()=>void proceed()}>
   {pending?'Thử lại đúng yêu cầu Continue':'Tiếp tục D2 sau xếp ghế'}</Button>}
 </div>;
}

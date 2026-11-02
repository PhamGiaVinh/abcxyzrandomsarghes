import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { useSupabaseClient } from '@/integrations/supabase/SupabaseClientContext';
import { waitForManualPlayerResponse } from '@/lib/floorManualPlayerIntent';
import { Button } from '@/components/ui/button';
import { MultiDayD2ContinuePanel } from './MultiDayD2ContinuePanel';
import { d2JournalKey, parseD2Application, parseD2Journal, parseD2Plan, parseD2Roster, saveD2Journal,
 validateD2Cancellation,
 type D2Journal, type D2Plan, type D2Roster } from '@/ops/floor/multiDayInitialDraw';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function MultiDayInitialDrawPanel({eventId}:{eventId:string}) {
 const {user,session}=useAuth();
 return <MultiDayInitialDrawWorkspace eventId={eventId} actorId={user?.id} sessionEpoch={sessionReadEpoch(session)}/>;
}
export function MultiDayInitialDrawWorkspace(props:{eventId:string;actorId:string|undefined;sessionEpoch:number}) {
 return <ScopedDraw key={JSON.stringify([props.eventId,props.actorId,props.sessionEpoch])} eventId={props.eventId} actorId={props.actorId}/>;
}
function ScopedDraw({eventId,actorId}:{eventId:string;actorId?:string}) {
 const client=useSupabaseClient();
 const [data,setData]=useState<D2Roster|null>(null),[journal,setJournal]=useState<D2Journal|null>(null);
 const [selected,setSelected]=useState<string[]>([]),[application,setApplication]=useState<D2Plan|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
 const [error,setError]=useState<string|null>(null),[storageError,setStorageError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const alive=useRef(true),working=useRef(false),generation=useRef(0),raw=useRef<string|null>(null);
 const rpc=useCallback(async(name:string,args:Record<string,unknown>)=>{
  const response=await waitForManualPlayerResponse(Promise.resolve((client as unknown as {
   rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
  }).rpc(name,args)));
  if(response.error)throw response.error;
  return response.data;
 },[client]);
 const refresh=useCallback(async()=>{
  const sequence=++generation.current;setLoading(true);
  try {
   if(!actorId)throw new Error('Cần đăng nhập để đọc D2.');
   const next=parseD2Roster(await rpc('multi_day_final_roster_v1',{p_event_id:eventId}),eventId);
   if(alive.current&&sequence===generation.current){setData(next);setError(null);}
  } catch(cause) {
   if(alive.current&&sequence===generation.current){setData(null);setError(cause instanceof Error?cause.message:'Không tải được nguồn D2.');}
  } finally {if(alive.current&&sequence===generation.current)setLoading(false);}
 },[actorId,eventId,rpc]);
 useEffect(()=>{
  alive.current=true;
  try {
   raw.current=actorId?sessionStorage.getItem(d2JournalKey(actorId,eventId)):null;
   const pending=raw.current&&actorId?parseD2Journal(raw.current,actorId,eventId):null;
   setJournal(pending);setSelected(pending?.selectedIds??[]);
  } catch {setBlocked(true);setStorageError('Không đọc được intent D2 đã lưu. Chưa được gửi thao tác mới.');}
  void refresh();
  return()=>{alive.current=false;};
 },[actorId,eventId,refresh]);
 const persist=(next:D2Journal)=>{raw.current=saveD2Journal(sessionStorage,next,raw.current);setJournal(next);};
 const run=async(task:()=>Promise<void>)=>{
  if(working.current||!alive.current||blocked)return;
  working.current=true;setBusy(true);setError(null);
  try {await task();}
  catch(cause){if(alive.current)setError(`Chưa xác minh được kết quả D2. Giữ nguyên yêu cầu; kiểm tra receipt trước khi thử lại. ${cause instanceof Error?cause.message:''}`);}
  finally {working.current=false;if(alive.current)setBusy(false);}
 };
 const clearPending=(intent:D2Journal)=>{
  const key=d2JournalKey(intent.actorId,eventId);
  if(sessionStorage.getItem(key)!==raw.current)throw new Error('D2_JOURNAL_CHANGED');
  sessionStorage.removeItem(key);
  if(sessionStorage.getItem(key)!==null)throw new Error('D2_JOURNAL_CLEAR_FAILED');
  raw.current=null;setJournal(null);
 };
 const finish=async(value:unknown,intent:D2Journal)=>{
  if(!intent.plan||!intent.applyRequestId)throw new Error('D2_INTENT_INVALID');
  const result=parseD2Application(value,intent.plan,intent.roster,intent.applyRequestId);
  if(!alive.current)return;
  clearPending(intent);setApplication(result);await refresh();
 };
 const cancelled=async(value:unknown,intent:D2Journal)=>{
  validateD2Cancellation(value,intent);
  if(!alive.current)return;
  clearPending(intent);setSelected([]);setNotice('Đã hủy phương án D2 trên server. Có thể chọn bàn và preview lại.');await refresh();
 };
 const sendPlan=async(intent:D2Journal,recover:boolean)=>{
  let value:unknown;
  try {value=await rpc(recover?'multi_day_get_initial_draw_plan_v1':'multi_day_plan_initial_draw_v1',recover
   ?{p_event_id:eventId,p_request_id:intent.requestId}
   :{p_event_id:eventId,p_tournament_table_ids:intent.selectedIds,p_expected_source_hash:intent.roster.sourceHash,p_request_id:intent.requestId});
  } catch(cause) {
   // These exact SQL exceptions roll back the preview before any plan exists.
   // Network/unknown outcomes must retain their original request key.
   const rejectedNotice=object(cause)
    ?cause.code==='23514'&&cause.message==='multi_day_initial_draw_insufficient_capacity'
     ?'Bàn đã chọn không đủ ghế trống. Hãy mở khóa ghế phù hợp hoặc chọn thêm bàn rồi xem phương án mới.'
     :cause.code==='40001'&&cause.message==='multi_day_initial_draw_source_stale'
      ?'Nguồn D2 đã thay đổi. Đã tải lại danh sách; hãy kiểm tra stack và chọn bàn để xem phương án mới.'
      :cause.code==='23514'&&cause.message==='multi_day_initial_draw_table_blocked'
       ?'Bàn đã chọn không còn sẵn sàng. Đã tải lại trạng thái bàn; hãy xử lý bàn bị chặn hoặc chọn bàn khác.'
       :null
    :null;
   if(!recover&&!intent.plan&&!intent.applyRequestId&&rejectedNotice){
    if(!alive.current)return;
    clearPending(intent);setSelected([]);setNotice(rejectedNotice);
    await refresh();return;
   }
   throw cause;
  }
  const candidate=recover&&object(value)&&value.ok===true?value.plan:value;
  const plan=parseD2Plan(candidate,intent.roster,intent.selectedIds);
  if(alive.current)persist({...intent,plan});
 };
 const preview=()=>void run(async()=>{
  if(!data||!actorId||journal||loading)return;
  const next:D2Journal={actorId,eventId,requestId:crypto.randomUUID(),selectedIds:selected,roster:data,plan:null,applyRequestId:null};
  persist(next);await sendPlan(next,false);
 });
 const apply=()=>void run(async()=>{
  if(!journal?.plan||journal.cancelRequestId)return;
  if(!journal.applyRequestId){
   if(!data||loading)throw new Error('Cần tải lại nguồn D2.');
   parseD2Plan(journal.plan,data,journal.selectedIds);
  }
  const intent={...journal,applyRequestId:journal.applyRequestId??crypto.randomUUID()};
  persist(intent);
  await finish(await rpc('multi_day_apply_initial_draw_v1',{p_plan_id:intent.plan!.planId,p_request_id:intent.applyRequestId}),intent);
 });
 const recover=()=>void run(async()=>{
  if(!journal)return;
  if(!journal.plan){await sendPlan(journal,true);return;}
  const response=await rpc('multi_day_get_initial_draw_resolution_v1',{p_event_id:eventId,p_plan_id:journal.plan.planId});
  if(!object(response)||response.ok!==true)throw new Error('D2_RESPONSE_INVALID');
  if(response.cancellation){await cancelled(response.cancellation,journal);return;}
  if(!object(response.application))throw new Error('Chưa tìm thấy receipt đã commit; không tạo key mới.');
  await finish(response.application,{...journal,applyRequestId:String(response.application.requestId)});
 });
 const cancel=()=>void run(async()=>{
  if(!journal?.plan)return;
  const intent={...journal,cancelRequestId:journal.cancelRequestId??crypto.randomUUID()};persist(intent);
  const response=await rpc('multi_day_cancel_initial_draw_v1',{p_plan_id:journal.plan.planId,p_request_id:intent.cancelRequestId});
  if(object(response)&&response.state==='APPLIED'&&object(response.application)){
   await finish(response.application,{...intent,applyRequestId:String(response.application.requestId)});return;
  }
  await cancelled(response,intent);
 });
 const verified=!!data&&!loading&&!error&&!blocked&&!!actorId;
 const unseated=data?.players.filter(p=>p.state==='UNSEATED')??[];
 const initialDrawComplete=!!data?.players.length&&data.players.every(p=>p.state==='SEATED'
  &&data.initialDraws?.some(draw=>draw.assignments.some(a=>a.participationId===p.participationId&&a.playerId===p.playerId)));
 const plan=journal?.plan;
 return <section aria-label="Xếp ghế D2" className="space-y-3 border-t border-border pt-3 text-sm">
  <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">Danh sách và bốc thăm D2</h4>
   <Button variant="outline" size="sm" disabled={busy||loading} onClick={()=>void refresh()}>Tải lại D2</Button></div>
  {loading&&<p role="status">Đang xác minh danh sách D2…</p>}
  {error&&<p role="alert" className="break-words text-destructive">{error}</p>}
  {storageError&&<p role="alert" className="break-words text-destructive">{storageError}</p>}
  {notice&&<p role="status">{notice}</p>}
  {data&&<><p>{data.players.length} người qualified · {unseated.length} chưa xếp ghế D2 ban đầu. Không thu buy-in lần nữa.</p>
   <p className="text-xs text-muted-foreground">Danh sách lưu stack mang vào D2 và trạng thái xếp ghế ban đầu; không phải stack hoặc ghế hiện tại. Theo dõi diễn biến hiện tại tại Floor/Tracker.</p>
   <ul className="space-y-1">{data.players.map(p=><li key={p.participationId} className="break-words">{p.name??'Thiếu chứng cứ tên'} · Stack mang vào D2: {p.stack.toLocaleString('vi-VN')} chip · {{SEATED:'Đã xếp ghế D2 ban đầu',UNSEATED:'Chưa xếp ghế D2 ban đầu',BLOCKED:'Cần xử lý trước khi xếp ghế D2'}[p.state]}{p.blocker&&` · ${p.blocker}`}</li>)}</ul>
   {data.heldSeedAdjustments===undefined&&data.players.some(p=>p.state==='SEATED')&&<p role="status" className="text-muted-foreground">Chưa xác minh được danh sách điều chỉnh seed đang giữ trên backend này.</p>}
   {!!data.heldSeedAdjustments?.length&&<div className="space-y-2 rounded border border-border p-3" aria-label="Điều chỉnh seed đang giữ">
    <h5 className="font-medium">Điều chỉnh seed đang giữ — chưa áp dụng</h5>
    <ul className="space-y-2">{data.heldSeedAdjustments.map(a=><li key={a.requestId} className="break-words">
     <p>{data.players.find(p=>p.participationId===a.participationId)?.name??a.playerId}</p>
     <p>Seed đã dùng: {a.priorSeedStack.toLocaleString('vi-VN')} chip · Đề xuất: {a.proposedSeedStack.toLocaleString('vi-VN')} chip</p>
    </li>)}</ul>
    <p className="text-muted-foreground">Chưa thay đổi stack đang chơi.</p>
   </div>}
   {!!data.initialDraws?.length&&<div className="space-y-2"><h5 className="font-medium">Ghế D2 ban đầu đã lưu</h5>
    {data.initialDraws.map(draw=><ul key={draw.planId} className="space-y-1">{draw.assignments.map(a=><li key={a.participationId} className="break-words">
     {a.name} → Bàn {a.tableNumber}, ghế {a.seatNumber} · {a.stack.toLocaleString('vi-VN')} chip ban đầu
    </li>)}</ul>)}
   </div>}
   {!journal&&!application&&initialDrawComplete&&<p role="status" className="text-muted-foreground">Toàn bộ người qualified đã có receipt xếp ghế D2 ban đầu. Xem ghế và stack hiện tại tại Floor/Tracker; không cần bốc thăm ban đầu lại.</p>}
   {!journal&&!application&&!initialDrawComplete&&<fieldset disabled={!verified||busy||!data.releaseEnabled} className="space-y-2"><legend className="font-medium">Chọn bàn đang mở cho D2</legend>
    {data.tables.length===0&&<p>Mở bàn thuộc Final Day trước khi bốc thăm.</p>}
    {data.tables.map(t=><label key={t.tournamentTableId} className="flex min-h-10 items-center gap-2 rounded border border-border p-2">
     <input type="checkbox" disabled={!!t.blocker} checked={selected.includes(t.tournamentTableId)} onChange={()=>setSelected(ids=>ids.includes(t.tournamentTableId)?ids.filter(id=>id!==t.tournamentTableId):[...ids,t.tournamentTableId])}/>
     <span>Bàn {t.tableNumber??'—'} · {t.capacity??'—'} ghế{t.blocker&&` · ${t.blocker}`}</span></label>)}
    <Button disabled={!selected.length||!unseated.length||data.players.some(p=>p.state==='BLOCKED')} onClick={preview}>Xem phương án D2</Button>
   </fieldset>}
  </>}
  {journal&&<div className="space-y-2 rounded border border-border p-2">
   <p role="status">{journal.applyRequestId?'Đang chờ xác minh apply D2.':plan?'Phương án đã lưu; retry không xáo lại ghế.':'Chưa xác minh được preview đã lưu.'}</p>
   {plan&&<ul>{plan.assignments.map(a=><li key={a.participationId} className="break-words">{a.name} → Bàn {a.tableNumber}, ghế {a.seatNumber} · {a.stack.toLocaleString('vi-VN')} chip</li>)}</ul>}
   <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={recover}>Kiểm tra receipt D2</Button>
    {!plan&&<Button disabled={busy} onClick={()=>void run(()=>sendPlan(journal,false))}>Thử lại đúng yêu cầu preview</Button>}
    {plan&&<><Button disabled={busy||!!journal.cancelRequestId||(!journal.applyRequestId&&!verified)} onClick={apply}>{journal.applyRequestId?'Thử lại đúng yêu cầu apply':'Xác nhận xếp D2'}</Button>
     <Button variant="outline" disabled={busy} onClick={cancel}>{journal.cancelRequestId?'Thử lại yêu cầu hủy D2':'Hủy phương án D2'}</Button></>}</div>
  </div>}
  {application&&<div role="status" className="space-y-1"><p>Đã xếp D2 theo receipt máy chủ.</p>{!data?.initialDraws?.some(d=>d.planId===application.planId)&&<ul>{application.assignments.map(a=><li key={a.participationId}>{a.name} → Bàn {a.tableNumber}, ghế {a.seatNumber}</li>)}</ul>}</div>}
  {data&&actorId&&<MultiDayD2ContinuePanel actorId={actorId} tournamentId={data.finalTournamentId} disabled={busy||loading||!!journal} onContinued={()=>void refresh()}/>}
 </section>;
}

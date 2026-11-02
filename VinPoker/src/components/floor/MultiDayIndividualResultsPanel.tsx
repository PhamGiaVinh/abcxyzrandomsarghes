import {useEffect,useRef,useState} from 'react';
import {useSupabaseClient} from '@/integrations/supabase/SupabaseClientContext';
import {callMultiDayFloorRpc} from '@/ops/floor/multiDayFloorRpc';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {Button} from '@/components/ui/button';
import {parseIndividualReview,initialIndividualOrder,readIndividualIntent,persistIndividualIntent,clearIndividualIntent,
 makeIndividualRankIntent,makeIndividualObligationIntent,parseIndividualObligationPreview,parseIndividualReceipt,
 type IndividualScope,type IndividualReview,type IndividualIntent,type IndividualObligationPreview} from '@/ops/floor/multiDayIndividualResults';

type Props=IndividualScope&{active:boolean;held:boolean;onHeld:(held:boolean)=>void};
const money=(amount:number)=>amount.toLocaleString('vi-VN')+' ₫';
export function MultiDayIndividualResultsPanel(props:Props){
 return <IndividualScopePanel key={JSON.stringify([props.actorId,props.eventId,props.backendScope])} {...props}/>;
}
function IndividualScopePanel(props:Props){
 const {onHeld}=props;
 const client=useSupabaseClient(),life=useRef(false),working=useRef(false);
 const [view,setView]=useState<IndividualReview|null>(null),[order,setOrder]=useState<string[]>([]);
 const [preview,setPreview]=useState<IndividualObligationPreview|null>(null),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const [journal,setJournal]=useState<{intent:IndividualIntent|null;error:boolean}>(()=>{
  try{return {intent:readIndividualIntent(sessionStorage,props),error:false};}catch{return {intent:null,error:true};}
 });
 useEffect(()=>{life.current=true;return()=>{life.current=false;};},[]);
 useEffect(()=>{onHeld(!!journal.intent||journal.error);},[journal,onHeld]);
 const rpc=(name:string,args:Record<string,unknown>)=>waitForManualPlayerResponse(callMultiDayFloorRpc<unknown>(client,name,args));
 const enabled=props.active&&!props.held&&!busy&&!journal.intent&&!journal.error;
 const fetchView=async()=>{
  const result=parseIndividualReview(await rpc('get_multi_day_individual_rank_review_v1',{p_event_id:props.eventId}),props.eventId);
  if(life.current){setView(result);setOrder(initialIndividualOrder(result));setConfirmed(false);setPreview(null);}
 };
 const load=async()=>{
  if(!life.current||!enabled||working.current)return;working.current=true;setBusy(true);setView(null);setPreview(null);setError(null);setNotice(null);setConfirmed(false);
  try{await fetchView();}catch{if(life.current)setError('Chưa xác minh được hạng cá nhân. Hãy tải lại; chưa chốt kết quả.');}
  finally{working.current=false;if(life.current)setBusy(false);}
 };
 const execute=async(intent:IndividualIntent,recovery:boolean)=>{
  if(working.current||!life.current)return;working.current=true;setBusy(true);setError(null);setNotice(null);
  try{
   const result=await rpc(recovery?(intent.kind==='rank'?'get_multi_day_individual_rank_receipt_v1':'get_multi_day_individual_obligation_receipt_v1')
    :(intent.kind==='rank'?'confirm_multi_day_individual_ranks_v1':'confirm_multi_day_individual_obligation_v1'),
    recovery?{p_event_id:props.eventId,p_request_id:intent.args.p_request_id}:intent.args);
   if(!life.current)return;
   if(!parseIndividualReceipt(result,intent,recovery)){setNotice('Chưa tìm thấy receipt. Giữ yêu cầu cũ để kiểm tra hoặc gửi lại.');return;}
   clearIndividualIntent(sessionStorage,intent);setJournal({intent:null,error:false});setPreview(null);setConfirmed(false);
   setNotice(intent.kind==='rank'?'Đã xác minh hạng cá nhân. Thao tác này không chốt nghĩa vụ hoặc ghi trả thưởng.':'Đã xác minh nghĩa vụ cá nhân. Thao tác này không ghi nhận trả thưởng.');
   try{await fetchView();}catch{if(life.current){setView(null);setError('Receipt đã xác minh; chưa tải lại được nguồn. Hãy đọc lại danh sách.');}}
  }catch(cause){
   if(!life.current)return;
   const e=cause as {code?:string;message?:string};
   const definitive=['individual_rank_source_changed','individual_rank_not_ready','individual_rank_chronology_mismatch','individual_rank_frozen_conflict',
    'individual_obligation_source_changed','individual_obligation_shortfall_unfunded'];
   if(!recovery&&e.code==='P0001'&&definitive.includes(e.message??'')){
    try{clearIndividualIntent(sessionStorage,intent);setJournal({intent:null,error:false});setView(null);setPreview(null);setConfirmed(false);
     setError('Nguồn hoặc thứ tự không còn hợp lệ. Chưa chốt yêu cầu này; hãy đọc lại và xác nhận lại.');}
    catch{setJournal({intent,error:true});setError('Không xác minh được journal. Tạm khóa thao tác mới.');}
   }else setError('Chưa xác minh được kết quả. Giữ nguyên yêu cầu, không tạo yêu cầu thay thế.');
  }finally{working.current=false;if(life.current)setBusy(false);}
 };
 const submit=(intent:IndividualIntent)=>{
  if(!life.current||!enabled||working.current)return;
  try{persistIndividualIntent(sessionStorage,intent);setJournal({intent,error:false});void execute(intent,false);}
  catch{setJournal(current=>({...current,error:true}));setError('Không lưu được yêu cầu. Chưa gửi thao tác.');}
 };
 const rank=()=>{
  if(!life.current||!enabled||!view||!confirmed)return;
  try{submit(makeIndividualRankIntent(props,view,order,crypto.randomUUID()));}
  catch{setError('Thứ tự chưa hợp lệ hoặc đã chốt trước đó. Hãy đọc lại nguồn.');}
 };
 const obligationPreview=async(participationId:string)=>{
  if(!life.current||!enabled||working.current||!view)return;working.current=true;setBusy(true);setPreview(null);setError(null);setNotice(null);
  try{const result=parseIndividualObligationPreview(await rpc('get_multi_day_individual_obligation_preview_v1',{
   p_event_id:props.eventId,p_participation_id:participationId}),view,participationId);if(life.current)setPreview(result);}
  catch{if(life.current)setError('Chưa xác minh được nghĩa vụ và ngân sách. Chưa chốt hoặc trả tiền.');}
  finally{working.current=false;if(life.current)setBusy(false);}
 };
 const confirmObligation=()=>{
  if(!life.current||!enabled||!view||!preview)return;
  try{submit(makeIndividualObligationIntent(props,view,preview,crypto.randomUUID()));}catch{setError('Bản xem trước chưa sẵn sàng để chốt.');}
 };
 const frozen=new Set(view?.individualResults.map(f=>f.entry_id)??[]);
 const canRank=!!view&&view.ranking.survivors>0&&view.ranking.survivors<view.field&&!view.ranking.activeHand
  &&!view.ranking.evidencePending&&!view.ranking.hasOfficial&&order.length>frozen.size;
 const move=(index:number,direction:-1|1)=>{
  const other=index+direction;if(!enabled||other<0||other>=order.length||frozen.has(order[index])||frozen.has(order[other]))return;
  const next=[...order];[next[index],next[other]]=[next[other],next[index]];setOrder(next);setConfirmed(false);setPreview(null);
 };
 return <section aria-label="Hạng và nghĩa vụ cá nhân Main Event" className="space-y-3 rounded-md border border-border p-3 text-sm">
  <h4 className="font-semibold">Hạng và nghĩa vụ cá nhân Main Event</h4>
  <p>Floor xác nhận thứ tự người đã bust từ hạng cao đến thấp. Hạng đã chốt được giữ nguyên. Thao tác chốt hạng và nghĩa vụ không ghi nhận trả thưởng.</p>
  {journal.error&&<p role="alert">Không xác minh được yêu cầu đã lưu. Tạm khóa thao tác mới.</p>}
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {busy&&<p role="status">Đang xác minh…</p>}
  <Button type="button" className="min-h-11" variant="outline" disabled={!enabled} onClick={()=>void load()}>Đọc lại hạng cá nhân</Button>
  {journal.intent&&<div className="space-y-2 rounded border border-amber-500/40 p-3">
   <p role="status">Yêu cầu {journal.intent.kind==='rank'?'chốt hạng':'chốt nghĩa vụ'} đang chờ xác minh. Giữ nguyên request qua tải lại trang.</p>
   <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy} onClick={()=>void execute(journal.intent!,true)}>Kiểm tra receipt cá nhân</Button>
    <Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={()=>void execute(journal.intent!,false)}>Gửi lại yêu cầu cá nhân cũ</Button></div>
  </div>}
  {view&&<>
   {view.individualObligations===null&&<p role="status">Chưa xác minh được nghĩa vụ đã chốt từ DB. Chưa thể chốt nghĩa vụ mới.</p>}
   {view.ranking.hasOfficial?<>
    <p>Giải đã chốt. Hạng chính thức từ DB:</p>
    <ol className="space-y-2">{view.ranking.entries.filter(entry=>entry.finishedPlace!==null)
     .sort((a,b)=>a.finishedPlace!-b.finishedPlace!).map(entry=><li key={entry.entryId} className="break-words">
      Hạng {entry.finishedPlace} · {entry.name} · entry #{entry.entryNo}
     </li>)}</ol>
   </>:<>
   <p>Còn {view.ranking.survivors}/{view.field} người chơi. Thứ tự cần Floor kiểm tra:</p>
   <ol className="space-y-2">{order.map((id,index)=>{
    const entry=view.ranking.entries.find(e=>e.entryId===id)!;
    return <li key={id} className="flex min-w-0 flex-wrap items-center gap-2">
     <span className="min-w-0 flex-1 break-words">Hạng {view.ranking.survivors+index+1} · {entry.name} · entry #{entry.entryNo} · {id.slice(-8)} {frozen.has(id)?'· Đã chốt':''}</span>
     <Button type="button" className="min-h-11 min-w-11" variant="outline" aria-label={`Nâng hạng entry ${id}`} disabled={!enabled||index===0||frozen.has(id)||frozen.has(order[index-1])} onClick={()=>move(index,-1)}>↑</Button>
     <Button type="button" className="min-h-11 min-w-11" variant="outline" aria-label={`Hạ hạng entry ${id}`} disabled={!enabled||index===order.length-1||frozen.has(id)||frozen.has(order[index+1])} onClick={()=>move(index,1)}>↓</Button>
    </li>;
   })}</ol>
   </>}
   {canRank?<><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} disabled={!enabled} onChange={e=>setConfirmed(e.target.checked)}/>Tôi đã kiểm tra và xác nhận thứ tự Floor ở trên</label>
    <Button type="button" className="min-h-11" disabled={!enabled||!confirmed} onClick={rank}>Chốt hạng cá nhân</Button></>:<p>Chưa có hạng mới đủ điều kiện chốt. Hạng đã chốt vẫn có thể xem trước nghĩa vụ.</p>}
   {view.individualResults.map(f=>{const owed=view.individualObligations?.find(o=>o.participationId===f.participation_id);return <div key={f.participation_id} className="space-y-1 border-t border-border pt-2">
    <p>Hạng đã chốt #{f.finished_place} · {view.ranking.entries.find(e=>e.entryId===f.entry_id)?.name} · entry {f.entry_id.slice(-8)}</p>
    {owed?<p>Đã chốt nghĩa vụ {money(owed.totalVnd)} · chưa phải trạng thái đã trả.</p>
     :view.individualObligations!==null&&<p>Chưa có nghĩa vụ cá nhân đã chốt.</p>}
    <Button type="button" className="min-h-11" variant="outline" disabled={!enabled} onClick={()=>void obligationPreview(f.participation_id)}>Xem nghĩa vụ hạng {f.finished_place}</Button>
   </div>;})}
  </>}
  {preview&&<div className="space-y-2 rounded border border-border p-3">
   <p>Hạng #{preview.quote.rank} · nghĩa vụ cá nhân {money(preview.quote.totalVnd)}</p>
   <p>Ngân sách toàn Main Event: cần {money(preview.budget.requiredTotalVnd)}, nguồn đã xác minh {money(preview.budget.fundedVnd)}, thiếu {money(preview.budget.requiredShortfallVnd)}.</p>
   <p>Chốt nghĩa vụ bất biến theo bản xem trước này; thao tác này không ghi nhận trả tiền.</p>
   {view?.individualObligations?.some(o=>o.participationId===preview.quote.participationId)
    ?<p role="status">Nghĩa vụ này đã chốt trong DB. Không tạo yêu cầu chốt mới.</p>
    :<Button type="button" className="min-h-11" disabled={!enabled||view?.individualObligations==null||preview.state!=='READY_TO_CONFIRM'} onClick={confirmObligation}>Chốt nghĩa vụ cá nhân</Button>}
  </div>}
 </section>;
}

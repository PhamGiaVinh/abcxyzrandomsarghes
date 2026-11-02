import {useEffect,useRef,useState} from 'react';
import type {MultiDayConfigurationPreview} from '@/ops/floor/multiDayFloorRead';
import {readPrizeConfigurationIntent,parsePrizeConfigurationIntent,submitPrizeConfiguration,reconcilePrizeConfiguration,
 type MultiDayPrizeConfigurationIntent,parsePrizeConfigurationReceiptLookup} from '@/ops/floor/multiDayPrizeConfigurationIntent';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

export type PrizeConfigurationProposal={preview:MultiDayConfigurationPreview;rows:Array<{position:number;amount:number}>};
type Props={actorId:string;eventId:string;backendScope:string;ownerEnabled:boolean;held:boolean;
 proposal:PrizeConfigurationProposal|null;onHeld:(held:boolean)=>void;onSaved:()=>void;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>};
export function MultiDayPrizeConfigurationControl({actorId,eventId,backendScope,ownerEnabled,held,proposal,onHeld,onSaved,rpc}:Props){
 const [journal,setJournal]=useState(()=>{
  try{return {intent:readPrizeConfigurationIntent(sessionStorage,actorId,eventId,backendScope),error:null as string|null};}
  catch{return {intent:null,error:'Không xác minh được yêu cầu lưu đang chờ. Giữ nguyên dữ liệu và tạm khóa thao tác.'};}
 });
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
 const live=useRef(false),inflight=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{onHeld(!!journal.intent||!!journal.error||busy);},[journal.intent,journal.error,busy,onHeld]);
 useEffect(()=>{setConfirmed(false);},[proposal]);
 const run=async(action:'probe'|'save'|'lookup'|'retry')=>{
  if(inflight.current||journal.error||held||!ownerEnabled)return;
  inflight.current=true;setBusy(true);setError(null);setNotice(null);
  try{
   if(action==='probe'){
    const args={p_event_id:eventId,p_request_id:crypto.randomUUID()};
    parsePrizeConfigurationReceiptLookup(await rpc('multi_day_prize_configuration_receipt_v1',args),args);
    if(live.current)setReady(true);
    return;
   }
   let intent=journal.intent;
   if(action==='save'){
    if(intent||!ready||!proposal||!confirmed||!reason.trim())return;
    const p=proposal.preview;
    intent=parsePrizeConfigurationIntent({actorId,eventId,backendScope,args:{p_event_id:eventId,p_rows:proposal.rows,
     p_expected_configuration_revision:p.configurationRevision,p_expected_rules_version:p.rulesVersion,
     p_expected_funding_revision:p.fundingRevision,p_expected_qualification_revision:p.qualificationRevision,
     p_expected_payout_input_hash:p.payoutInputHash,p_request_id:crypto.randomUUID(),p_reason:reason}},actorId,eventId,backendScope);
   }
   if(!intent)return;
   let result;
   try{result=action==='lookup'?await reconcilePrizeConfiguration(sessionStorage,intent,rpc):await submitPrizeConfiguration(sessionStorage,intent,rpc);}
   finally{
    if(live.current){
     try{setJournal({intent:readPrizeConfigurationIntent(sessionStorage,actorId,eventId,backendScope),error:null});}
     catch{setJournal({intent:null,error:'Không đọc được yêu cầu đang chờ; không tạo request mới.'});}
    }
   }
   if(!live.current)return;
   if(result.state==='NOT_FOUND')setNotice('Chưa tìm thấy receipt. Giữ nguyên yêu cầu; chỉ thử lại đúng request đã lưu.');
   else{setNotice('Đã lưu cấu hình bảng thưởng. Chưa cấp quỹ, chốt nghĩa vụ hoặc thanh toán.');setReady(false);setConfirmed(false);onSaved();}
  }catch(cause){if(live.current)setError(cause&&typeof cause==='object'&&'message' in cause?String(cause.message):'Không xác minh được kết quả. Giữ nguyên yêu cầu đang chờ.');}
  finally{inflight.current=false;if(live.current)setBusy(false);}
 };
 const disabled=busy||held||!ownerEnabled||!!journal.error;
 return <div className="space-y-2 border-t pt-3" aria-label="Lưu cấu hình payout Main Event">
  <p>Chỉ lưu bảng thưởng; không thêm quỹ, không chốt nghĩa vụ, không trả tiền.</p>
  {journal.error&&<p role="alert">{journal.error}</p>}
  {journal.intent?<>
   <p role="status">Đang giữ yêu cầu {journal.intent.args.p_request_id}. Không tạo yêu cầu khác trước khi xác minh kết quả.</p>
   <Button type="button" variant="outline" disabled={disabled} onClick={()=>void run('lookup')}>Kiểm tra kết quả lưu</Button>
   <Button type="button" variant="outline" disabled={disabled} onClick={()=>void run('retry')}>Thử lại đúng yêu cầu đang chờ</Button>
  </>:<>
   <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={disabled||ready} onClick={()=>void run('probe')}>Kiểm tra quyền và backend lưu bảng thưởng</Button>
   {ready&&<>
    <Label htmlFor={`prize-reason-${eventId}`}>Lý do lưu cấu hình</Label>
    <Input id={`prize-reason-${eventId}`} value={reason} maxLength={500} disabled={disabled} onChange={e=>setReason(e.target.value)}/>
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled||!proposal}
     onChange={e=>setConfirmed(e.target.checked)}/><span>Tôi xác nhận lưu đúng đề xuất đang hiển thị, kể cả khoản thiếu quỹ đã nêu.</span></label>
    <Button type="button" disabled={disabled||!proposal||!confirmed||!reason.trim()} onClick={()=>void run('save')}>Lưu bảng thưởng Main Event</Button>
   </>}
  </>}
  {!ownerEnabled&&<p>Chỉ owner được lưu cấu hình; quyền vẫn được server kiểm tra lại.</p>}
  {busy&&<p role="status">Đang xác minh…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </div>;
}

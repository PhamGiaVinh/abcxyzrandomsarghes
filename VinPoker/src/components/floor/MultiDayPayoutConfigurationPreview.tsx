import {useEffect,useMemo,useRef,useState} from 'react';
import {useSupabaseClient} from '@/integrations/supabase/SupabaseClientContext';
import {callMultiDayFloorRpc} from '@/ops/floor/multiDayFloorRpc';
import {isLivePrizeConfigurationPreview,type MultiDayConfigurationPreview} from '@/ops/floor/multiDayFloorRead';
import {parseD2Roster,type D2Player} from '@/ops/floor/multiDayInitialDraw';
import {computePayouts,defaultRoundingUnit,type PayoutArchetype} from '@/lib/payoutEngine';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {MultiDayPrizeConfigurationControl} from './MultiDayPrizeConfigurationControl';
import type {ComponentProps} from 'react';

type Props={eventId:string;qualificationHash:string;rankedPlaces:number;buyInVnd:number|undefined;
 authoringEnabled?:boolean;saveContext?:Omit<ComponentProps<typeof MultiDayPrizeConfigurationControl>,'proposal'|'rpc'>};
const money=(n:number)=>`${n.toLocaleString('vi-VN')}đ`;
const presets=['DAILY','INTL','MULTI','TRITON'] as const;

/** Proposal only. Canonical server evaluates every amount; no save/pay/finalize path. */
export function MultiDayPayoutConfigurationPreview(props:Props){
 return <ConfigurationScope key={JSON.stringify([props.eventId,props.qualificationHash,props.rankedPlaces,props.buyInVnd,
  props.saveContext?.actorId,props.saveContext?.backendScope])} {...props}/>;
}
function ConfigurationScope({eventId,qualificationHash,rankedPlaces,buyInVnd,authoringEnabled=true,saveContext}:Props){
 const client=useSupabaseClient();
 const [baseline,setBaseline]=useState<MultiDayConfigurationPreview|null>(null);
 const [result,setResult]=useState<MultiDayConfigurationPreview|null>(null);
 const [proposedRows,setProposedRows]=useState<Array<{position:number;amount:number}>>([]);
 const proposal=useMemo(()=>authoringEnabled&&result?{preview:result,rows:proposedRows}:null,[authoringEnabled,result,proposedRows]);
 const [names,setNames]=useState<D2Player[]>([]),[namesUnavailable,setNamesUnavailable]=useState(false);
 const [preset,setPreset]=useState<PayoutArchetype>('MULTI'),[budget,setBudget]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lifetime=useRef({live:false,sequence:0}),inflight=useRef(false);
 useEffect(()=>{const context=lifetime.current;context.live=true;return()=>{context.live=false;context.sequence++;};},[]);
 const validTarget=Number.isSafeInteger(rankedPlaces)&&rankedPlaces>0;
 const rpc=<T,>(name:string,args:Record<string,unknown>)=>waitForManualPlayerResponse(callMultiDayFloorRpc<T>(client,name,args));
 const preview=async(rows:Array<{position:number;amount:number}>,minimum:boolean)=>{
  if(inflight.current||!validTarget)return;
  inflight.current=true;setBusy(true);setError(null);setResult(null);
  const context=lifetime.current,revision=++context.sequence,current=()=>context.live&&context.sequence===revision;
  try{
   const value=await rpc<MultiDayConfigurationPreview>('multi_day_payout_configuration_preview_v1',{p_event_id:eventId,p_proposed_rows:rows});
   if(!current())return;
   if(value.itmPlaces!==rankedPlaces)throw new Error('Số hạng đã thay đổi. Hãy làm mới nguồn Main Event.');
   setProposedRows(rows);setResult(value);
   if(minimum){
    setBaseline(value);
    // Reserve the server's other participation floors and separate bag cash.
    const reserved=isLivePrizeConfigurationPreview(value)
      ?(value.planningBudget.field-value.itmPlaces)*value.planningBudget.eventFloorVnd
        +value.planningBudget.nonselectedMinCash.reduce((sum,row)=>sum+row.amountVnd,0)
      :value.obligations.reduce((sum,row)=>sum+row.nonselectedBagMinCashVnd+(row.rank>value.itmPlaces?row.participationFloorVnd:0),0);
    setBudget(String(value.directPoolVnd+value.transferPoolVnd+value.recordedOverlayVnd-reserved));
    setNames([]);setNamesUnavailable(false);
    if(!isLivePrizeConfigurationPreview(value))try{
     const roster=parseD2Roster(await rpc<unknown>('multi_day_final_roster_v1',{p_event_id:eventId}),eventId);
     if(roster.qualificationHash!==qualificationHash)throw new Error('qualification changed');
     if(current()){setNames(roster.players);setNamesUnavailable(value.obligations.some(row=>!roster.players.some(p=>p.participationId===row.participationId&&p.playerId===row.playerId&&p.name?.trim())));}
    }catch{if(current()){setNames([]);setNamesUnavailable(true);}}
   }
  }catch(cause){
   if(current()){
    if(minimum)setBaseline(null);
    const text=cause&&typeof cause==='object'&&'message' in cause?String(cause.message):'Không tải được bản xem trước.';
    setError(/PGRST202|42883|does not exist|Could not find the function/.test(text)
      ?'Contract xem trước cấu hình chưa được cài trên môi trường này. Chưa lưu hoặc trả tiền.':text);
   }
  }finally{inflight.current=false;if(current())setBusy(false);}
 };
 const previewPreset=()=>{
  if(!baseline||inflight.current)return;
  try{
   const amount=Number(budget);
   if(!budget.trim()||!Number.isSafeInteger(amount)||amount<=0)throw new Error('Quỹ dự kiến phải là số nguyên dương.');
   if(!buyInVnd||!Number.isSafeInteger(buyInVnd)||buyInVnd<0)throw new Error('Chưa xác minh được buy-in để chọn đơn vị làm tròn.');
   const floor=isLivePrizeConfigurationPreview(baseline)?baseline.planningBudget.eventFloorVnd
    :Math.max(...baseline.obligations.filter(row=>row.rank<=rankedPlaces).map(row=>row.participationFloorVnd));
   if(!(floor>0))throw new Error('Chưa có mức sàn dương phù hợp với mẫu payout.');
   const draft=computePayouts({entries:rankedPlaces,itmPercent:1,prizePool:amount,floor,
    archetype:preset,roundingUnit:defaultRoundingUnit(buyInVnd)});
   if(draft.itmPlaces!==rankedPlaces)throw new Error('Quỹ dự kiến chưa đủ cho số hạng đã khóa; không tự giảm số suất.');
   void preview(draft.rows.map(row=>({position:row.position,amount:row.amount})),false);
  }catch(cause){setResult(null);setError(cause instanceof Error?cause.message:'Không tạo được mẫu payout.');}
 };
 return <section aria-label="Xem trước cấu hình payout Main Event" className="space-y-3 rounded border border-border p-3 text-sm">
  {authoringEnabled&&<><h4 className="font-medium">Mẫu payout Main Event · xem trước</h4>
  <p>Không lưu bảng thưởng, không cấp overlay, không chốt nghĩa vụ hoặc trả tiền.</p>
  <Button type="button" variant="outline" disabled={busy||!validTarget} onClick={()=>void preview(Array.from({length:rankedPlaces},(_,i)=>({position:i+1,amount:0})),true)}>Xem trước mức sàn Main Event</Button>
  {baseline&&<fieldset disabled={busy} className="space-y-2">
   <Label htmlFor={`preset-${eventId}`}>Mẫu payout</Label>
   <select id={`preset-${eventId}`} className="w-full rounded border bg-background p-2" value={preset} onChange={e=>{setPreset(e.target.value as PayoutArchetype);setResult(null);}}>
    {presets.map(value=><option key={value} value={value}>{value}</option>)}
   </select>
   <Label htmlFor={`budget-${eventId}`}>Quỹ dự kiến riêng cho {rankedPlaces} hạng (VND)</Label>
   <Input id={`budget-${eventId}`} type="number" value={budget} onChange={e=>{setBudget(e.target.value);setResult(null);}}/>
   <p className="text-xs text-muted-foreground">Đã tách mức sàn ngoài nhóm hạng và tiền bag không chọn. Sửa số dự kiến không làm tăng quỹ đã được cấp.</p>
   <Button type="button" variant="outline" onClick={previewPreset}>Xem trước mẫu payout</Button>
  </fieldset>}
  {busy&&<p role="status">Đang kiểm tra đề xuất trên server…</p>}
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  {result&&<>
   <p role="status">Đề xuất chưa lưu · thiếu quỹ {money(result.requiredShortfallVnd)} · {result.itmPlaces} hạng thưởng.</p>
   {isLivePrizeConfigurationPreview(result)?<>
    <p>Giải đang diễn ra. Bảng thưởng dự kiến theo hạng, chưa gán người nhận hoặc chốt nghĩa vụ.</p>
    <table className="w-full table-fixed text-left text-xs">
     <caption className="pb-2 text-left">Bảng thưởng dự kiến trước khi chốt hạng</caption>
     <thead><tr><th scope="col" className="py-2">Hạng</th><th scope="col" className="py-2 text-right">Thưởng dự kiến</th></tr></thead>
     <tbody>{result.prizePositions.map(row=><tr key={row.position} className="border-t">
      <td className="py-2">#{row.position}</td><td className="break-words py-2 text-right tabular-nums">{money(row.amountVnd)}</td>
     </tr>)}</tbody>
    </table>
   </>:<>
   {(namesUnavailable||!busy&&result.obligations.some(row=>!names.some(p=>p.participationId===row.participationId&&p.playerId===row.playerId&&p.name?.trim())))&&<p role="status">Chưa xác minh được tên một số người; hiển thị ID đầy đủ, không ghép tên suy đoán.</p>}
   <table className="w-full table-fixed text-left text-xs">
    <caption className="pb-2 text-left">Người nhận trong đề xuất chưa lưu</caption>
    <thead><tr><th scope="col" className="w-10 py-2">Hạng</th><th scope="col" className="p-2">Người chơi</th><th scope="col" className="w-24 py-2 text-right">Nghĩa vụ</th></tr></thead>
    <tbody>{result.obligations.map(row=><tr key={row.participationId} className="border-t align-top">
     <td className="py-2">#{row.rank}</td><td className="break-words p-2 [overflow-wrap:anywhere]">{names.find(p=>p.participationId===row.participationId&&p.playerId===row.playerId)?.name?.trim()||row.playerId}</td>
     <td className="break-words py-2 text-right tabular-nums">{money(row.totalVnd)}</td>
    </tr>)}</tbody>
   </table>
   </>}
  </>}
  </>}
  {saveContext&&<MultiDayPrizeConfigurationControl {...saveContext} rpc={rpc}
   proposal={proposal}/>}
 </section>;
}

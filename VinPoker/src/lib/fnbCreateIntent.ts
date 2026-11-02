import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';
import {fnbShiftBackend} from './fnbShiftIntent';

export type FnbCreatePayload={source:'counter';table:string|null;customer:string|null;note:string|null;
 lines:{menu_item_id:string;qty:number}[];table_ref?:string|null;player_ref?:string|null;reason?:string|null};
export type FnbCreateIntent={actorId:string;clubId:string;backend:string;requestId:string;operation:'order'|'comp';payload:FnbCreatePayload};
type Store=Pick<Storage,'getItem'|'setItem'>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const text=(v:unknown)=>v===null||typeof v==='string';
export const fnbCreateJournalKey=(actor:string,club:string,backend:string)=>{
 if(!uuid(actor)||!uuid(club))throw new Error('FNB_CREATE_SCOPE_INVALID');
 return `vinpoker:fnb-create:v1:${JSON.stringify([fnbShiftBackend(backend),actor,club])}`;
};
export function parseFnbCreateIntent(raw:string,actor:string,club:string,backend:string):FnbCreateIntent {
 const i:unknown=JSON.parse(raw);
 if(!object(i)||Object.keys(i).length!==6||i.actorId!==actor||i.clubId!==club||i.backend!==fnbShiftBackend(backend)
  ||![i.actorId,i.clubId,i.requestId].every(uuid)||!['order','comp'].includes(String(i.operation))||!object(i.payload))throw new Error('FNB_CREATE_JOURNAL_INVALID');
 const p=i.payload, keys=['source','table','customer','note','lines',...(i.operation==='order'?['table_ref','player_ref']:['reason'])];
 if(Object.keys(p).length!==keys.length||!keys.every(k=>Object.prototype.hasOwnProperty.call(p,k))||p.source!=='counter'
  ||![p.table,p.customer,p.note].every(text)||!Array.isArray(p.lines)||!p.lines.length
  ||!p.lines.every(line=>object(line)&&Object.keys(line).length===2&&uuid(line.menu_item_id)
   &&typeof line.qty==='number'&&Number.isSafeInteger(line.qty)&&line.qty>0)
  ||(i.operation==='order'?![p.table_ref,p.player_ref].every(v=>v===null||uuid(v)):!text(p.reason)))throw new Error('FNB_CREATE_JOURNAL_INVALID');
 return i as unknown as FnbCreateIntent;
}
export function readFnbCreateJournal(storage:Store,actor:string,club:string,backend:string):{state:'pending'|'settled';intent:FnbCreateIntent}|null {
 const raw=storage.getItem(fnbCreateJournalKey(actor,club,backend));if(raw===null)return null;
 const row:unknown=JSON.parse(raw);
 if(!object(row)||Object.keys(row).length!==2||!['pending','settled'].includes(String(row.state)))throw new Error('FNB_CREATE_JOURNAL_INVALID');
 return {state:row.state as 'pending'|'settled',intent:parseFnbCreateIntent(JSON.stringify(row.intent),actor,club,backend)};
}
export function persistFnbCreateIntent(storage:Store,intent:FnbCreateIntent,settled=false):void {
 parseFnbCreateIntent(JSON.stringify(intent),intent.actorId,intent.clubId,intent.backend);
 const prior=readFnbCreateJournal(storage,intent.actorId,intent.clubId,intent.backend);
 if(settled){if(!prior||canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('FNB_CREATE_JOURNAL_CHANGED');}
 else if(prior&&(prior.state==='pending'&&canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent)
  ||prior.state==='settled'&&prior.intent.requestId===intent.requestId))throw new Error('FNB_CREATE_INTENT_UNRESOLVED_OR_SETTLED');
 const key=fnbCreateJournalKey(intent.actorId,intent.clubId,intent.backend),raw=canonicalVoiceJson({state:settled?'settled':'pending',intent});
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('FNB_CREATE_JOURNAL_WRITE_FAILED');
}
export function fnbCreateWrite(i:FnbCreateIntent){
 const p=i.payload;
 return {name:i.operation==='order'?'fnb_create_order':'fnb_create_comp_order',args:{p_club_id:i.clubId,p_source:p.source,
  p_table_label:p.table,p_customer_name:p.customer,p_note:p.note,p_lines:p.lines,p_client_request_id:i.requestId,
  ...(i.operation==='order'?{p_table_ref:p.table_ref,p_player_ref:p.player_ref}:{p_comp_reason:p.reason})}};
}
export function fnbCreateCancel(i:FnbCreateIntent){
 return {p_club_id:i.clubId,p_request_id:i.requestId,p_expected_actor:i.actorId,p_operation:i.operation,p_payload:i.payload};
}
export type FnbCreateReceipt={id:string;status:'pending'|'paid'|'shipped'|'cancelled'|'expired';subtotal_vnd:number;is_comp:boolean};
export function resolveFnbCreateReceipt(i:FnbCreateIntent,value:unknown):{status:'unknown'|'not_found'|'cancelled'}|{status:'found';order:FnbCreateReceipt} {
 if(!object(value)||value.error!=null||value.actor_id!==i.actorId||value.club_id!==i.clubId||value.request_id!==i.requestId)return {status:'unknown'};
 if(value.status==='not_found'&&value.operation===undefined&&value.intent===undefined&&value.order===undefined)return {status:'not_found'};
 if(value.operation!==i.operation||canonicalVoiceJson(value.intent)!==canonicalVoiceJson(i.payload))return {status:'unknown'};
 if(value.status==='cancelled'&&Object.keys(value).length===6
  &&Object.keys(value).every(k=>['status','actor_id','club_id','request_id','operation','intent'].includes(k)))return {status:'cancelled'};
 if(value.status!=='found'||!object(value.order))return {status:'unknown'};
 const o=value.order;
 if(!uuid(o.id)||!['pending','paid','shipped','cancelled','expired'].includes(String(o.status))||o.is_comp!==(i.operation==='comp')
  ||typeof o.subtotal_vnd!=='number'||!Number.isSafeInteger(o.subtotal_vnd)||o.subtotal_vnd<0)return {status:'unknown'};
 return {status:'found',order:o as unknown as FnbCreateReceipt};
}

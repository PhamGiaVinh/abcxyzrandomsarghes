import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';

export type FnbShiftIntent={actorId:string;clubId:string;backend:string;requestId:string;operation:'open'|'close';shiftId:string|null;amount:number;note:string|null};
type Store=Pick<Storage,'getItem'|'setItem'>;
export type FnbShiftJournal={state:'pending'|'settled';intent:FnbShiftIntent};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
export function fnbShiftBackend(value:unknown):string {
 if(typeof value!=='string'||!value.trim())throw new Error('FNB_SHIFT_BACKEND_INVALID');
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('FNB_SHIFT_BACKEND_INVALID');
 return url.origin+url.pathname.replace(/\/+$/,'');
}
export function fnbShiftJournalKey(actorId:string,clubId:string,backend:string):string {
 if(!uuid(actorId)||!uuid(clubId))throw new Error('FNB_SHIFT_SCOPE_INVALID');
 return `vinpoker:fnb-shift:v1:${JSON.stringify([fnbShiftBackend(backend),actorId,clubId])}`;
}
export function parseFnbShiftIntent(raw:string,actorId:string,clubId:string,backend:string):FnbShiftIntent {
 const i:unknown=JSON.parse(raw);
 if(!object(i)||Object.keys(i).length!==8||i.actorId!==actorId||i.clubId!==clubId||i.backend!==fnbShiftBackend(backend)
  ||![i.actorId,i.clubId,i.requestId].every(uuid)||!integer(i.amount)||i.amount<0
  ||(i.note!==null&&typeof i.note!=='string')
  ||!(i.operation==='open'&&i.shiftId===null&&i.note===null||i.operation==='close'&&uuid(i.shiftId)))throw new Error('FNB_SHIFT_JOURNAL_INVALID');
 return i as unknown as FnbShiftIntent;
}
export function readFnbShiftJournal(storage:Store,actor:string,club:string,backend:string):FnbShiftJournal|null {
 const raw=storage.getItem(fnbShiftJournalKey(actor,club,backend));if(raw===null)return null;
 const row:unknown=JSON.parse(raw);
 if(!object(row)||Object.keys(row).length!==2||!['pending','settled'].includes(String(row.state)))throw new Error('FNB_SHIFT_JOURNAL_INVALID');
 return {state:row.state as FnbShiftJournal['state'],intent:parseFnbShiftIntent(JSON.stringify(row.intent),actor,club,backend)};
}
/** Caller holds the origin-wide Web Lock for the backend/actor/club key. */
export function persistFnbShiftIntent(storage:Store,intent:FnbShiftIntent):void {
 parseFnbShiftIntent(JSON.stringify(intent),intent.actorId,intent.clubId,intent.backend);
 const prior=readFnbShiftJournal(storage,intent.actorId,intent.clubId,intent.backend);
 if(prior?.state==='pending'&&canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('FNB_SHIFT_INTENT_UNRESOLVED');
 if(prior?.state==='settled'&&prior.intent.requestId===intent.requestId)throw new Error('FNB_SHIFT_INTENT_SETTLED');
 const key=fnbShiftJournalKey(intent.actorId,intent.clubId,intent.backend),raw=canonicalVoiceJson({state:'pending',intent});
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('FNB_SHIFT_JOURNAL_WRITE_FAILED');
}
export function settleFnbShiftIntent(storage:Store,intent:FnbShiftIntent):void {
 const prior=readFnbShiftJournal(storage,intent.actorId,intent.clubId,intent.backend);
 if(!prior||canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('FNB_SHIFT_JOURNAL_CHANGED');
 const key=fnbShiftJournalKey(intent.actorId,intent.clubId,intent.backend),raw=canonicalVoiceJson({state:'settled',intent});
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('FNB_SHIFT_JOURNAL_WRITE_FAILED');
}
export function fnbShiftPayload(i:FnbShiftIntent) {
 return i.operation==='open'?{operation:'open',club:i.clubId,float:i.amount}:{operation:'close',shift:i.shiftId,counted:i.amount,note:i.note};
}
export function fnbShiftWrite(i:FnbShiftIntent) {
 return i.operation==='open'?{name:'fnb_open_shift_v2',args:{p_club_id:i.clubId,p_opening_float_vnd:i.amount,p_client_request_id:i.requestId,p_expected_actor:i.actorId}}:
  {name:'fnb_close_shift_v2',args:{p_shift_id:i.shiftId,p_counted_cash_vnd:i.amount,p_note:i.note,p_client_request_id:i.requestId,p_expected_actor:i.actorId}};
}
export function fnbShiftCancel(i:FnbShiftIntent) {
 return {p_club_id:i.clubId,p_operation:i.operation,p_shift_id:i.shiftId,p_amount_vnd:i.amount,p_note:i.note,p_request_id:i.requestId,p_expected_actor:i.actorId};
}
export type FnbShiftResolution={status:'unknown'|'not_found'|'cancelled'}|{status:'applied';shiftId:string;alreadyOpen:boolean;variance:number|null};
export function resolveFnbShiftResult(i:FnbShiftIntent,value:unknown):FnbShiftResolution {
 if(!object(value)||value.actor_id!==i.actorId||value.club_id!==i.clubId||value.request_id!==i.requestId||value.operation!==i.operation||value.error!=null)return {status:'unknown'};
 if(value.status==='cancelled'&&Object.keys(value).every(key=>['status','actor_id','club_id','request_id','operation'].includes(key)))return {status:'cancelled'};
 if(value.status!=='ok'||!uuid(value.shift_id))return {status:'unknown'};
 if(i.operation==='open'){
  if(typeof value.already_open!=='boolean'||!integer(value.opening_float_vnd)||value.opening_float_vnd<0
   ||!value.already_open&&value.opening_float_vnd!==i.amount)return {status:'unknown'};
  return {status:'applied',shiftId:value.shift_id,alreadyOpen:value.already_open,variance:null};
 }
 if(value.shift_id!==i.shiftId||value.counted_cash_vnd!==i.amount||![value.sales_vnd,value.refunds_vnd,value.opening_float_vnd,value.expected_cash_vnd,value.variance_vnd].every(integer)
  ||(value.sales_vnd as number)<0||(value.refunds_vnd as number)<0||(value.opening_float_vnd as number)<0
  ||value.expected_cash_vnd!==(value.sales_vnd as number)-(value.refunds_vnd as number)
  ||!Number.isSafeInteger((value.opening_float_vnd as number)+(value.expected_cash_vnd as number))
  ||value.variance_vnd!==i.amount-((value.opening_float_vnd as number)+(value.expected_cash_vnd as number)))return {status:'unknown'};
 return {status:'applied',shiftId:value.shift_id,alreadyOpen:false,variance:value.variance_vnd as number};
}
export function resolveFnbShiftReceipt(i:FnbShiftIntent,value:unknown):FnbShiftResolution {
 if(!object(value)||value.actor_id!==i.actorId||value.club_id!==i.clubId||value.request_id!==i.requestId)return {status:'unknown'};
 if(value.status==='not_found'&&value.intent===undefined&&value.result===undefined)return {status:'not_found'};
 if(value.status!=='found'||!object(value.intent)||canonicalVoiceJson(value.intent)!==canonicalVoiceJson(fnbShiftPayload(i))||!object(value.result))return {status:'unknown'};
 const result=value.result;
 if(Object.entries({actor_id:i.actorId,club_id:i.clubId,request_id:i.requestId,operation:i.operation})
  .some(([key,expected])=>result[key]!==undefined&&result[key]!==expected))return {status:'unknown'};
 return resolveFnbShiftResult(i,{...result,actor_id:i.actorId,club_id:i.clubId,request_id:i.requestId,operation:i.operation});
}
export function parseFnbShiftCash(value:string,optional=false):number|null {
 const text=value.trim();if(optional&&!text)return 0;
 if(!/^\d+$/.test(text)&&!/^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/.test(text))return null;
 const amount=Number(text.replace(/[., ]/g,''));return Number.isSafeInteger(amount)&&amount>=0?amount:null;
}

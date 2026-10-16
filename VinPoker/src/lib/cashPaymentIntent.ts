import { canonicalVoiceJson } from './trackerVoice/canonicalRequest';
import { waitForManualPlayerResponse } from './floorManualPlayerIntent';

export type CashPaymentIntent = {actor_id:string;club_id:string;tournament_id:string;
  registration_id:string;amount:number;request_id:string};
type Journal = {state:'pending'|'settled';intent:CashPaymentIntent};
type Store = Pick<Storage,'getItem'|'setItem'>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function validIntent(v:unknown):v is CashPaymentIntent {
  return object(v)&&Object.keys(v).length===6&&[v.actor_id,v.club_id,v.tournament_id,v.registration_id,v.request_id].every(uuid)
    &&typeof v.amount==='number'&&Number.isSafeInteger(v.amount)&&v.amount>0;
}
export const cashPaymentJournalKey=(actor:string,club:string)=>`vp:cash-payment:v1:${actor}:${club}`;
export function readCashPaymentJournal(storage:Store,actor:string,club:string):Journal|null {
  const raw=storage.getItem(cashPaymentJournalKey(actor,club));if(raw===null)return null;
  const value:unknown=JSON.parse(raw);
  if(!object(value)||Object.keys(value).length!==2||!['pending','settled'].includes(String(value.state))
    ||!validIntent(value.intent)||value.intent.actor_id!==actor||value.intent.club_id!==club)
    throw new Error('CASH_JOURNAL_INVALID');
  return value as Journal;
}
/** Call while holding the origin-wide Web Lock for this actor/club. */
export function persistCashPaymentIntent(storage:Store,intent:CashPaymentIntent):void {
  if(!validIntent(intent))throw new Error('CASH_JOURNAL_INVALID');
  const prior=readCashPaymentJournal(storage,intent.actor_id,intent.club_id);
  if(prior?.state==='pending')throw new Error('CASH_INTENT_UNRESOLVED');
  const key=cashPaymentJournalKey(intent.actor_id,intent.club_id),raw=canonicalVoiceJson({state:'pending',intent});
  storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('CASH_JOURNAL_WRITE_FAILED');
}
/** A settled marker fences late replies; never overwrite another intent. */
export function settleCashPaymentIntent(storage:Store,intent:CashPaymentIntent):void {
  const prior=readCashPaymentJournal(storage,intent.actor_id,intent.club_id);
  if(!prior||canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('CASH_JOURNAL_CHANGED');
  const key=cashPaymentJournalKey(intent.actor_id,intent.club_id),raw=canonicalVoiceJson({state:'settled',intent});
  storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('CASH_JOURNAL_SETTLE_FAILED');
}
export type CashPaymentOutcome = {status:'unknown'}|{status:'recorded'|'rejected'|'cancelled';result:Record<string,unknown>};
export function validateCashPaymentOutcome(intent:CashPaymentIntent,value:unknown):CashPaymentOutcome {
  if(!object(value)||value.ok!==true||!validIntent(value.intent)
    ||canonicalVoiceJson(value.intent)!==canonicalVoiceJson(intent))return {status:'unknown'};
  if(value.status==='unknown')return {status:'unknown'};
  const result=value.result;if(!object(result))return {status:'unknown'};
  if(value.status==='recorded'&&result.ok===true)return {status:'recorded',result};
  if(value.status==='rejected'&&result.ok===false&&typeof result.error==='string'&&result.error)return {status:'rejected',result};
  if(value.status==='cancelled'&&result.ok===false&&result.error==='cash_intent_cancelled')return {status:'cancelled',result};
  return {status:'unknown'};
}
export async function resolveCashPaymentIntent(rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>,intent:CashPaymentIntent,action:'record'|'read'|'cancel'):Promise<CashPaymentOutcome> {
  try {
    const response=await waitForManualPlayerResponse(Promise.resolve(rpc('resolve_cashier_cash_buyin_intent_v1',{p_intent:intent,p_action:action})));
    return response.error?{status:'unknown'}:validateCashPaymentOutcome(intent,response.data);
  }catch{return {status:'unknown'};}
}

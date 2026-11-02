import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';
import {fnbShiftBackend} from './fnbShiftIntent';

export type FnbStockInPayload = {ingredient_id:string;qty_purchase:number;unit_cost_purchase:number};
export type FnbStockInIntent = {actorId:string;clubId:string;backend:string;requestId:string;payload:FnbStockInPayload};
type Store = Pick<Storage,'getItem'|'setItem'>;
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const uuid = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const finite = (v:unknown):v is number => typeof v==='number' && Number.isFinite(v);
const keys = (v:Record<string,unknown>,expected:string[]) => Object.keys(v).length===expected.length
  && expected.every(k=>Object.prototype.hasOwnProperty.call(v,k));

export function fnbStockInJournalKey(actor:string,club:string,backend:string):string {
  if(!uuid(actor)||!uuid(club))throw new Error('FNB_STOCK_SCOPE_INVALID');
  return `vinpoker:fnb-stock-in:v1:${JSON.stringify([fnbShiftBackend(backend),actor,club])}`;
}

export function parseFnbStockInIntent(raw:string,actor:string,club:string,backend:string):FnbStockInIntent {
  const i:unknown=JSON.parse(raw);
  if(!object(i)||!keys(i,['actorId','clubId','backend','requestId','payload'])
    ||i.actorId!==actor||i.clubId!==club||i.backend!==fnbShiftBackend(backend)
    ||![i.actorId,i.clubId,i.requestId].every(uuid)||!object(i.payload))throw new Error('FNB_STOCK_JOURNAL_INVALID');
  const p=i.payload;
  if(!keys(p,['ingredient_id','qty_purchase','unit_cost_purchase'])||!uuid(p.ingredient_id)
    ||!finite(p.qty_purchase)||p.qty_purchase<=0||!finite(p.unit_cost_purchase)||p.unit_cost_purchase<0)
    throw new Error('FNB_STOCK_JOURNAL_INVALID');
  return i as unknown as FnbStockInIntent;
}

export function readFnbStockInJournal(storage:Store,actor:string,club:string,backend:string):{state:'pending'|'settled';intent:FnbStockInIntent}|null {
  const raw=storage.getItem(fnbStockInJournalKey(actor,club,backend));
  if(raw===null)return null;
  const row:unknown=JSON.parse(raw);
  if(!object(row)||!keys(row,['state','intent'])||!['pending','settled'].includes(String(row.state)))throw new Error('FNB_STOCK_JOURNAL_INVALID');
  return {state:row.state as 'pending'|'settled',intent:parseFnbStockInIntent(JSON.stringify(row.intent),actor,club,backend)};
}

export function persistFnbStockInIntent(storage:Store,intent:FnbStockInIntent,settled=false):void {
  parseFnbStockInIntent(JSON.stringify(intent),intent.actorId,intent.clubId,intent.backend);
  const prior=readFnbStockInJournal(storage,intent.actorId,intent.clubId,intent.backend);
  if(settled){
    if(!prior||canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('FNB_STOCK_JOURNAL_CHANGED');
  }else if(prior && (prior.state==='pending' && canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent)
    ||prior.state==='settled' && prior.intent.requestId===intent.requestId))throw new Error('FNB_STOCK_INTENT_UNRESOLVED_OR_SETTLED');
  const key=fnbStockInJournalKey(intent.actorId,intent.clubId,intent.backend);
  const raw=canonicalVoiceJson({state:settled?'settled':'pending',intent});
  storage.setItem(key,raw);
  if(storage.getItem(key)!==raw)throw new Error('FNB_STOCK_JOURNAL_WRITE_FAILED');
}

export function fnbStockInWrite(i:FnbStockInIntent){
  return {p_club_id:i.clubId,p_ingredient_id:i.payload.ingredient_id,
    p_qty_purchase:i.payload.qty_purchase,p_unit_cost_purchase:i.payload.unit_cost_purchase,p_client_request_id:i.requestId};
}

export type FnbStockInReceipt={movementId:string;delta:number;balanceAfter:number};
export function resolveFnbStockInReceipt(i:FnbStockInIntent,value:unknown):{status:'unknown';reason?:'missing_intent'}|{status:'not_found'}|{status:'found';receipt:FnbStockInReceipt} {
  if(!Array.isArray(value))return {status:'unknown'};
  if(value.length===0)return {status:'not_found'};
  if(value.length!==1||!object(value[0]))return {status:'unknown'};
  const r=value[0];
  const expected={version:1,club_id:i.clubId,...i.payload};
  if(!uuid(r.id)||r.club_id!==i.clubId||r.actor!==i.actorId||r.client_request_id!==i.requestId
    ||r.ingredient_id!==i.payload.ingredient_id||r.reason!=='stock_in'||r.ref_type!=='manual'
    ||!finite(r.delta)||r.delta<=0||!finite(r.unit_cost)||r.unit_cost<0||!finite(r.balance_after))return {status:'unknown'};
  if(r.details===null||object(r.details)&&(r.details.stock_in_intent_v1===undefined||r.details.stock_in_intent_v1===null))
    return {status:'unknown',reason:'missing_intent'};
  if(!object(r.details)||!object(r.details.stock_in_intent_v1)
    ||canonicalVoiceJson(r.details.stock_in_intent_v1)!==canonicalVoiceJson(expected))return {status:'unknown'};
  // This is the balance saved with this movement, never a recomputed current balance or average cost.
  return {status:'found',receipt:{movementId:r.id,delta:r.delta,balanceAfter:r.balance_after}};
}

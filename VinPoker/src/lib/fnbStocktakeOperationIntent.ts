import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';
import {fnbShiftBackend} from './fnbShiftIntent';

type Scope={actorId:string;clubId:string;backend:string;requestId:string};
export type StocktakeOperationIntent=Scope&({kind:'open'}|{kind:'commit';sessionId:string;counts:Record<string,string>});
type Store=Pick<Storage,'getItem'|'setItem'>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function stocktakeOperationKey(actor:string,club:string,backend:string){
  if(!uuid(actor)||!uuid(club))throw new Error('STOCKTAKE_OPERATION_SCOPE_INVALID');
  return `vinpoker:fnb-stocktake-operation:v1:${JSON.stringify([fnbShiftBackend(backend),actor,club])}`;
}
function validate(value:unknown,actor:string,club:string,backend:string):StocktakeOperationIntent{
  if(!object(value)||value.actorId!==actor||value.clubId!==club||value.backend!==fnbShiftBackend(backend)
    ||![value.actorId,value.clubId,value.requestId].every(uuid))throw new Error('STOCKTAKE_OPERATION_INVALID');
  if(value.kind==='open'&&Object.keys(value).length===5)return value as unknown as StocktakeOperationIntent;
  if(value.kind==='commit'&&Object.keys(value).length===7&&uuid(value.sessionId)&&object(value.counts)
    &&Object.entries(value.counts).every(([id,qty])=>uuid(id)&&typeof qty==='string'&&qty.trim()!==''&&Number.isFinite(Number(qty))&&Number(qty)>=0))return value as unknown as StocktakeOperationIntent;
  throw new Error('STOCKTAKE_OPERATION_INVALID');
}
export function readStocktakeOperation(storage:Store,actor:string,club:string,backend:string):{state:'pending'|'settled'|'counts_changed';intent:StocktakeOperationIntent}|null{
  const raw=storage.getItem(stocktakeOperationKey(actor,club,backend));if(raw===null)return null;
  const row:unknown=JSON.parse(raw);
  if(!object(row)||Object.keys(row).length!==2||row.state!=='pending'&&row.state!=='settled'&&row.state!=='counts_changed')throw new Error('STOCKTAKE_OPERATION_INVALID');
  const intent=validate(row.intent,actor,club,backend);
  if(row.state==='counts_changed'&&intent.kind!=='commit')throw new Error('STOCKTAKE_OPERATION_INVALID');
  return {state:row.state,intent};
}
/** Only the exact no-write server rejection may release this pending commit. */
export function rejectStocktakeOperationCountsChanged(storage:Store,intent:StocktakeOperationIntent){
  validate(intent,intent.actorId,intent.clubId,intent.backend);
  const prior=readStocktakeOperation(storage,intent.actorId,intent.clubId,intent.backend);
  if(intent.kind!=='commit'||prior?.state!=='pending'||canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('STOCKTAKE_OPERATION_CHANGED');
  const key=stocktakeOperationKey(intent.actorId,intent.clubId,intent.backend),raw=canonicalVoiceJson({state:'counts_changed',intent});
  storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('STOCKTAKE_OPERATION_WRITE_FAILED');
}
/** Local intent, never a fabricated server receipt or proof that abort rolled back. */
export function writeStocktakeOperation(storage:Store,intent:StocktakeOperationIntent,settled=false){
  validate(intent,intent.actorId,intent.clubId,intent.backend);
  const prior=readStocktakeOperation(storage,intent.actorId,intent.clubId,intent.backend);
  if(settled){if(prior?.state!=='pending'||canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('STOCKTAKE_OPERATION_CHANGED');}
  else if(prior?.state==='pending'||prior?.intent.requestId===intent.requestId)throw new Error('STOCKTAKE_OPERATION_UNRESOLVED');
  const key=stocktakeOperationKey(intent.actorId,intent.clubId,intent.backend),raw=canonicalVoiceJson({state:settled?'settled':'pending',intent});
  storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('STOCKTAKE_OPERATION_WRITE_FAILED');
}

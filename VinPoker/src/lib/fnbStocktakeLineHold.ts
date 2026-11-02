import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';
import {fnbShiftBackend} from './fnbShiftIntent';

export type StocktakeLineHold={actorId:string;clubId:string;backend:string;requestId:string;sessionId:string;ingredientId:string;countedQty:number};
type Store=Pick<Storage,'getItem'|'setItem'>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function stocktakeLineHoldKey(actor:string,club:string,backend:string){
  if(!uuid(actor)||!uuid(club))throw new Error('STOCKTAKE_HOLD_SCOPE_INVALID');
  return `vinpoker:fnb-stocktake-line:v1:${JSON.stringify([fnbShiftBackend(backend),actor,club])}`;
}
function validate(value:unknown,actor:string,club:string,backend:string):StocktakeLineHold{
  if(!object(value)||Object.keys(value).length!==7||value.actorId!==actor||value.clubId!==club||value.backend!==fnbShiftBackend(backend)
    ||![value.actorId,value.clubId,value.requestId,value.sessionId,value.ingredientId].every(uuid)
    ||typeof value.countedQty!=='number'||!Number.isFinite(value.countedQty)||value.countedQty<0)throw new Error('STOCKTAKE_HOLD_INVALID');
  return value as unknown as StocktakeLineHold;
}
export function readStocktakeLineHold(storage:Store,actor:string,club:string,backend:string):{state:'pending'|'settled';intent:StocktakeLineHold}|null{
  const raw=storage.getItem(stocktakeLineHoldKey(actor,club,backend));if(raw===null)return null;
  const row:unknown=JSON.parse(raw);
  if(!object(row)||Object.keys(row).length!==2||row.state!=='pending'&&row.state!=='settled')throw new Error('STOCKTAKE_HOLD_INVALID');
  return {state:row.state as 'pending'|'settled',intent:validate(row.intent,actor,club,backend)};
}
/** This local identity is NOT a server request receipt. Only the original exact ACK may settle it. */
export function writeStocktakeLineHold(storage:Store,intent:StocktakeLineHold,settled=false){
  validate(intent,intent.actorId,intent.clubId,intent.backend);
  const prior=readStocktakeLineHold(storage,intent.actorId,intent.clubId,intent.backend);
  if(settled){if(prior?.state!=='pending'||canonicalVoiceJson(prior.intent)!==canonicalVoiceJson(intent))throw new Error('STOCKTAKE_HOLD_CHANGED');}
  else if(prior?.state==='pending'||prior?.intent.requestId===intent.requestId)throw new Error('STOCKTAKE_HOLD_UNRESOLVED');
  const key=stocktakeLineHoldKey(intent.actorId,intent.clubId,intent.backend),raw=canonicalVoiceJson({state:settled?'settled':'pending',intent});
  storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('STOCKTAKE_HOLD_WRITE_FAILED');
}

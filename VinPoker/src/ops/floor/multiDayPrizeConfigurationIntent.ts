import {z} from 'zod';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal.ts';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{32}$/),money=z.number().int().nonnegative().safe();
const backend=z.string().url().refine(value=>{
 try{
  const url=new URL(value);
  return !url.username&&!url.password&&!url.search&&!url.hash
   &&(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 }catch{return false;}
});
const argsSchema=z.object({p_event_id:uuid,p_rows:z.array(z.object({position:z.number().int().positive().safe(),
 amount:money.max(9999999999)}).strict()).min(1).refine(rows=>rows.every((row,index)=>row.position===index+1
  &&(index===0||row.amount<=rows[index-1].amount))),
 p_expected_configuration_revision:hash,p_expected_rules_version:hash,p_expected_funding_revision:hash,
 p_expected_qualification_revision:hash,p_expected_payout_input_hash:hash,p_request_id:uuid,
 p_reason:z.string().trim().min(1).max(500),
}).strict();
const intentSchema=z.object({actorId:uuid,eventId:uuid,backendScope:backend,args:argsSchema}).strict();
export type MultiDayPrizeConfigurationIntent=z.infer<typeof intentSchema>;
export type MultiDayPrizeConfigurationArgs=z.infer<typeof argsSchema>;
export const prizeConfigurationJournalKey=(actor:string,event:string)=>eventJournalKey('prize-configuration',actor,event);
export function parsePrizeConfigurationIntent(value:unknown,actor:string,event:string,backendScope:string){
 const intent=intentSchema.parse(value);
 if(intent.actorId!==actor||intent.eventId!==event||intent.args.p_event_id!==event||intent.backendScope!==backendScope)
  throw Error('MULTIDAY_PRIZE_CONFIGURATION_SCOPE_CONFLICT');
 return intent;
}
export function readPrizeConfigurationIntent(storage:Pick<Storage,'getItem'>,actor:string,event:string,backendScope:string){
 const raw=storage.getItem(prizeConfigurationJournalKey(actor,event));
 return raw===null?null:parsePrizeConfigurationIntent(JSON.parse(raw),actor,event,backendScope);
}
export function persistPrizeConfigurationIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:MultiDayPrizeConfigurationIntent){
 const verified=parsePrizeConfigurationIntent(intent,intent.actorId,intent.eventId,intent.backendScope);
 persistEventJournal(storage,'prize-configuration',intent.actorId,intent.eventId,JSON.stringify(verified));
}
export function clearPrizeConfigurationIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:MultiDayPrizeConfigurationIntent){
 const verified=parsePrizeConfigurationIntent(intent,intent.actorId,intent.eventId,intent.backendScope);
 clearEventJournal(storage,'prize-configuration',intent.actorId,intent.eventId,JSON.stringify(verified));
}
const configured=z.object({ok:z.literal(true),state:z.literal('CONFIGURED'),idempotent:z.boolean(),
 eventId:uuid,requestId:uuid,configurationRevision:hash,previousConfigurationRevision:hash,payoutInputHash:hash,
 requiredShortfallVnd:money,fundingExecution:z.literal('NOT_PERFORMED'),paymentExecution:z.literal('NOT_PERFORMED'),
 obligationFinalization:z.literal('NOT_PERFORMED'),requestPayload:z.object({
  event:uuid,rows:argsSchema.shape.p_rows,configuration:hash,rules:hash,funding:hash,qualification:hash,proposal:hash,
  reason:z.string().trim().min(1).max(500),
 }).strict()});
const missing=z.object({ok:z.literal(true),state:z.literal('NOT_FOUND'),eventId:uuid,requestId:uuid});
export function parsePrizeConfigurationReceiptLookup(value:unknown,args:Record<string,unknown>){
 const result=z.union([configured,missing]).safeParse(value);
 if(!result.success||result.data.eventId!==args.p_event_id||result.data.requestId!==args.p_request_id)
  throw Error('Multi-day prize configuration receipt scope is unverified.');
 return result.data;
}
export function parsePrizeConfigurationSaveReceipt(value:unknown,args:Record<string,unknown>){
 const parsed=configured.safeParse(value),expected=argsSchema.safeParse(args);
 if(!parsed.success||!expected.success||parsed.data.eventId!==expected.data.p_event_id
  ||parsed.data.requestId!==expected.data.p_request_id
  ||parsed.data.previousConfigurationRevision!==expected.data.p_expected_configuration_revision
  ||parsed.data.payoutInputHash!==expected.data.p_expected_payout_input_hash
  ||parsed.data.requestPayload.event!==expected.data.p_event_id
  ||parsed.data.requestPayload.configuration!==expected.data.p_expected_configuration_revision
  ||parsed.data.requestPayload.rules!==expected.data.p_expected_rules_version
  ||parsed.data.requestPayload.funding!==expected.data.p_expected_funding_revision
  ||parsed.data.requestPayload.qualification!==expected.data.p_expected_qualification_revision
  ||parsed.data.requestPayload.proposal!==expected.data.p_expected_payout_input_hash
  ||parsed.data.requestPayload.reason!==expected.data.p_reason
  ||JSON.stringify(parsed.data.requestPayload.rows)!==JSON.stringify(expected.data.p_rows))
  throw Error('Multi-day prize configuration outcome is unverified. Keep the original request.');
 return parsed.data;
}
/** NOT_FOUND is recovery evidence only. It is never a successful write or permission
 * to discard an unknown nonce; retry must retain the entire original intent. */
export function parsePrizeConfigurationReceiptRead(value:unknown,intent:MultiDayPrizeConfigurationIntent){
 const result=parsePrizeConfigurationReceiptLookup(value,intent.args);
 return result.state==='NOT_FOUND'?result:parsePrizeConfigurationSaveReceipt(result,intent.args);
}
type JournalStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type ConfigurationRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
/** Persist before sending; any unknown outcome retains the same nonce and payload.
 * A server rejection is not permission to erase a previously unknown attempt. */
export async function submitPrizeConfiguration(storage:JournalStorage,intent:MultiDayPrizeConfigurationIntent,rpc:ConfigurationRpc){
 const verified=parsePrizeConfigurationIntent(intent,intent.actorId,intent.eventId,intent.backendScope);
 persistPrizeConfigurationIntent(storage,verified);
 const result=parsePrizeConfigurationSaveReceipt(await rpc('multi_day_save_prize_configuration_v1',verified.args),verified.args);
 clearPrizeConfigurationIntent(storage,verified);
 return result;
}
export async function reconcilePrizeConfiguration(storage:JournalStorage,intent:MultiDayPrizeConfigurationIntent,rpc:ConfigurationRpc){
 const verified=parsePrizeConfigurationIntent(intent,intent.actorId,intent.eventId,intent.backendScope);
 const retained=readPrizeConfigurationIntent(storage,verified.actorId,verified.eventId,verified.backendScope);
 if(!retained||JSON.stringify(retained)!==JSON.stringify(verified))throw Error('MULTIDAY_PRIZE_CONFIGURATION_PENDING_CHANGED');
 const result=parsePrizeConfigurationReceiptRead(await rpc('multi_day_prize_configuration_receipt_v1',{
  p_event_id:verified.eventId,p_request_id:verified.args.p_request_id,
 }),verified);
 if(result.state==='CONFIGURED')clearPrizeConfigurationIntent(storage,verified);
 return result;
}

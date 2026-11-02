import {z} from 'zod';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal.ts';
const text=z.string().min(1),hash=z.string().regex(/^[a-f0-9]{32}$/i);
const schema=z.object({actorId:text,eventId:text,args:z.object({p_event_id:text,p_expected_rules_version:hash,
 p_expected_funding_revision:hash,p_expected_qualification_revision:hash,p_expected_payout_input_hash:hash,p_request_id:z.string().uuid()}).strict()}).strict();
export type MultiDayFinalizationIntent=z.infer<typeof schema>;
export const finalizationJournalKey=(actor:string,event:string)=>eventJournalKey('finalize',actor,event);
/** Only for the first send of a newly retained nonce. A received database
 * rejection rolls back that RPC; transport/receipt errors stay unknown. */
export function definitiveFirstFinalizationFailure(cause:unknown):boolean{
 return !!cause&&typeof cause==='object'&&'code' in cause&&typeof cause.code==='string'
  &&(/^(22|23|40|42)[0-9A-Z]{3}$/.test(cause.code)||cause.code==='P0001');
}
export function parseFinalizationIntent(value:unknown,actor:string,event:string):MultiDayFinalizationIntent{
 const intent=schema.parse(value);
 if(intent.actorId!==actor||intent.eventId!==event||intent.args.p_event_id!==event)throw Error('MULTIDAY_FINALIZATION_SCOPE_CONFLICT');
 return intent;
}
export function readFinalizationIntent(storage:Pick<Storage,'getItem'>,actor:string,event:string){
 const raw=storage.getItem(finalizationJournalKey(actor,event));
 return raw===null?null:parseFinalizationIntent(JSON.parse(raw),actor,event);
}
export function persistFinalizationIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:MultiDayFinalizationIntent){
 persistEventJournal(storage,'finalize',intent.actorId,intent.eventId,JSON.stringify(intent));
}
export function clearFinalizationIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:MultiDayFinalizationIntent){
 clearEventJournal(storage,'finalize',intent.actorId,intent.eventId,JSON.stringify(intent));
}

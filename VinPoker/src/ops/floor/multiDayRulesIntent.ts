import {z} from 'zod';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal.ts';
const schema=z.object({actorId:z.string().min(1),eventId:z.string().min(1),itmPercent:z.number().finite().gt(0).max(100),args:z.object({
 p_event_id:z.string().min(1),p_policy:z.enum(['SELECT_LARGEST','SUM_STACKS']),p_min_cash_x:z.number().finite().min(0).max(100),
 p_day2_percent:z.number().finite().gt(0).max(100),
}).strict()}).strict().refine(i=>i.args.p_day2_percent>=i.itmPercent);
export type MultiDayRulesIntent=z.infer<typeof schema>;
export const rulesJournalKey=(actor:string,event:string)=>eventJournalKey('rules',actor,event);
export function parseRulesIntent(value:unknown,actor:string,event:string){
 const intent=schema.parse(value);
 if(intent.actorId!==actor||intent.eventId!==event||intent.args.p_event_id!==event)throw Error('MULTIDAY_RULES_SCOPE_CONFLICT');
 return intent;
}
export function readRulesIntent(storage:Pick<Storage,'getItem'>,actor:string,event:string){
 const raw=storage.getItem(rulesJournalKey(actor,event));
 return raw===null?null:parseRulesIntent(JSON.parse(raw),actor,event);
}
export function persistRulesIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:MultiDayRulesIntent){
 persistEventJournal(storage,'rules',intent.actorId,intent.eventId,JSON.stringify(intent));
}
export function clearRulesIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:MultiDayRulesIntent){
 clearEventJournal(storage,'rules',intent.actorId,intent.eventId,JSON.stringify(intent));
}

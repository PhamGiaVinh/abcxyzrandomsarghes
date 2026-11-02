import {z} from 'zod';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal.ts';
const text=z.string().min(1);
const schema=z.object({actorId:text,eventId:text,policy:z.enum(['SELECT_LARGEST','SUM_STACKS']),args:z.object({
 p_event_id:text,p_bag_ids:z.array(z.string().uuid()).min(1).refine(ids=>new Set(ids).size===ids.length),
 p_expected_source_hash:z.string().regex(/^[a-f0-9]{32}$/i),p_request_id:z.string().uuid(),
}).strict()}).strict();
export type MultiDayQualificationIntent=z.infer<typeof schema>;
export const qualificationJournalKey=(actor:string,event:string)=>eventJournalKey('qualify',actor,event);
export function parseQualificationIntent(value:unknown,actor:string,event:string):MultiDayQualificationIntent{
 const intent=schema.parse(value);
 if(intent.actorId!==actor||intent.eventId!==event||intent.args.p_event_id!==event)throw Error('MULTIDAY_QUALIFICATION_SCOPE_CONFLICT');
 return intent;
}
export function readQualificationIntent(storage:Pick<Storage,'getItem'>,actor:string,event:string){
 const raw=storage.getItem(qualificationJournalKey(actor,event));
 return raw===null?null:parseQualificationIntent(JSON.parse(raw),actor,event);
}
export function persistQualificationIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:MultiDayQualificationIntent){
 persistEventJournal(storage,'qualify',intent.actorId,intent.eventId,JSON.stringify(intent));
}
export function clearQualificationIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:MultiDayQualificationIntent){
 clearEventJournal(storage,'qualify',intent.actorId,intent.eventId,JSON.stringify(intent));
}

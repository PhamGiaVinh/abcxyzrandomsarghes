import {z} from 'zod';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal.ts';
const schema=z.object({actorId:z.string().min(1),eventId:z.string().min(1),args:z.object({
 p_event_id:z.string().min(1),p_kind:z.enum(['OBLIGATION_DELTA','PAYMENT_REVERSAL']),p_participation_id:z.string().uuid(),
 p_original_payment_id:z.string().uuid().nullable(),p_delta_vnd:z.number().int().safe().refine(n=>n!==0),
 p_expected_revision:z.string().regex(/^[a-f0-9]{32}$/i),p_reason:z.string().trim().min(8).max(500),
 p_evidence_ref:z.string().trim().min(8).max(200),p_request_id:z.string().uuid(),
}).strict().refine(a=>a.p_kind==='PAYMENT_REVERSAL'?a.p_original_payment_id!==null&&a.p_delta_vnd<0:a.p_original_payment_id===null)}).strict();
export type MultiDayCorrectionIntent=z.infer<typeof schema>;
export const correctionJournalKey=(actor:string,event:string)=>eventJournalKey('correction',actor,event);
export function parseCorrectionIntent(value:unknown,actor:string,event:string){
 const intent=schema.parse(value);
 if(intent.actorId!==actor||intent.eventId!==event||intent.args.p_event_id!==event)throw Error('MULTIDAY_CORRECTION_SCOPE_CONFLICT');
 return intent;
}
export function readCorrectionIntent(storage:Pick<Storage,'getItem'>,actor:string,event:string){
 const raw=storage.getItem(correctionJournalKey(actor,event));
 return raw===null?null:parseCorrectionIntent(JSON.parse(raw),actor,event);
}
export function persistCorrectionIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:MultiDayCorrectionIntent){
 persistEventJournal(storage,'correction',intent.actorId,intent.eventId,JSON.stringify(intent));
}
export function clearCorrectionIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:MultiDayCorrectionIntent){
 clearEventJournal(storage,'correction',intent.actorId,intent.eventId,JSON.stringify(intent));
}

import {z} from 'zod';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal.ts';
const schema=z.object({actorId:z.string().min(1),eventId:z.string().min(1),args:z.object({
 p_request_id:z.string().uuid(),p_approval_request_id:z.string().uuid(),
}).strict()}).strict();
export type MultiDayApprovalIntent=z.infer<typeof schema>;
export const approvalJournalKey=(actor:string,event:string)=>eventJournalKey('approve',actor,event);
export function parseApprovalIntent(value:unknown,actor:string,event:string){
 const intent=schema.parse(value);
 if(intent.actorId!==actor||intent.eventId!==event)throw Error('MULTIDAY_APPROVAL_SCOPE_CONFLICT');
 return intent;
}
export function readApprovalIntent(storage:Pick<Storage,'getItem'>,actor:string,event:string){
 const raw=storage.getItem(approvalJournalKey(actor,event));
 return raw===null?null:parseApprovalIntent(JSON.parse(raw),actor,event);
}
export function persistApprovalIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:MultiDayApprovalIntent){
 persistEventJournal(storage,'approve',intent.actorId,intent.eventId,JSON.stringify(intent));
}
export function clearApprovalIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:MultiDayApprovalIntent){
 clearEventJournal(storage,'approve',intent.actorId,intent.eventId,JSON.stringify(intent));
}

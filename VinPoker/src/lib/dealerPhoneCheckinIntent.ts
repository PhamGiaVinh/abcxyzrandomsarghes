import {z} from 'zod';
import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';
import {CHECKIN_CODE_LABELS,type DealerPhoneCheckinResponse} from './dealerSwingPhone';
const id=z.string().uuid();
const entry=z.object({entry_id:id,mode:z.enum(['scheduled','unscheduled']),input_method:z.enum(['camera','paste','manual_list']),
 user_id:id.nullable(),dealer_id:id.nullable(),shift_assignment_id:id.nullable(),reason:z.string().nullable()}).strict()
 .refine(e=>e.input_method==='manual_list'?e.dealer_id!==null&&e.user_id===null:e.user_id!==null&&e.dealer_id===null)
 .refine(e=>e.mode==='scheduled'?e.shift_assignment_id!==null&&e.reason===null:e.shift_assignment_id===null&&!!e.reason?.trim());
const schema=z.object({actorId:id,clubId:id,requestId:id,entries:z.array(entry).min(1).max(50),
 labels:z.array(z.object({entryId:id,dealerId:id,name:z.string()}).strict()).min(1).max(50)}).strict().refine(i=>
 new Set(i.entries.map(e=>e.entry_id)).size===i.entries.length&&i.labels.length===i.entries.length
 &&new Set(i.labels.map(e=>e.entryId)).size===i.labels.length&&i.labels.every(l=>i.entries.some(e=>e.entry_id===l.entryId)));
export type DealerPhoneCheckinIntent=z.infer<typeof schema>&Scope;
type Scope={actorId:string;clubId:string};
type Journal=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const phoneCheckinJournalKey=(s:Scope)=>`vinpoker:phone-checkin:v1:${s.actorId}:${s.clubId}`;
export function readPhoneCheckinIntent(storage:Pick<Storage,'getItem'>,scope:Scope){
 const raw=storage.getItem(phoneCheckinJournalKey(scope));if(raw===null)return null;
 const intent=schema.parse(JSON.parse(raw));
 if(intent.actorId!==scope.actorId||intent.clubId!==scope.clubId)throw Error('PHONE_CHECKIN_SCOPE_MISMATCH');
 return {...intent,actorId:intent.actorId,clubId:intent.clubId};
}
export function persistPhoneCheckinIntent(storage:Journal,intent:DealerPhoneCheckinIntent){
 schema.parse(intent);const previous=readPhoneCheckinIntent(storage,intent);
 if(previous&&canonicalVoiceJson(previous)!==canonicalVoiceJson(intent))throw Error('PHONE_CHECKIN_PENDING_CHANGED');
 const raw=JSON.stringify(intent);storage.setItem(phoneCheckinJournalKey(intent),raw);
 if(storage.getItem(phoneCheckinJournalKey(intent))!==raw)throw Error('PHONE_CHECKIN_JOURNAL_UNVERIFIED');
}
export function settlePhoneCheckinIntent(storage:Journal,intent:DealerPhoneCheckinIntent){
 if(canonicalVoiceJson(readPhoneCheckinIntent(storage,intent))!==canonicalVoiceJson(intent))throw Error('PHONE_CHECKIN_PENDING_CHANGED');
 storage.removeItem(phoneCheckinJournalKey(intent));
 if(storage.getItem(phoneCheckinJournalKey(intent))!==null)throw Error('PHONE_CHECKIN_JOURNAL_UNVERIFIED');
}
export function phoneCheckinReceipt(value:unknown,intent:DealerPhoneCheckinIntent):DealerPhoneCheckinResponse|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as DealerPhoneCheckinResponse;
 if(!['completed','partial'].includes(r.outcome)||r.request_id!==intent.requestId||r.club_id!==intent.clubId
  ||!Array.isArray(r.results)||r.results.length!==intent.entries.length)return null;
 const seen=new Set<string>();let successes=0;
 for(const result of r.results){
  if(!result||typeof result!=='object'||seen.has(result.entry_id)||!intent.entries.some(e=>e.entry_id===result.entry_id)
   ||!Object.prototype.hasOwnProperty.call(CHECKIN_CODE_LABELS,result.code))return null;
  const label=intent.labels.find(l=>l.entryId===result.entry_id)!;
  const success=['checked_in_waiting','checked_in_available','already_checked_in'].includes(result.code);
  if((success||result.dealer_id!=null)&&result.dealer_id!==label.dealerId)return null;
  seen.add(result.entry_id);if(success)successes++;
 }
 return (r.outcome==='completed'?successes===r.results.length:successes<r.results.length)?r:null;
}

import {canonicalVoiceJson} from './trackerVoice/canonicalRequest.ts';
import {waitForManualPlayerResponse} from './floorManualPlayerIntent.ts';
import {parseTournamentSchedule} from './parsedTournamentSchedule.ts';

export type ScheduleRow={club_id:string;name:string;start_time:string;buy_in:number;starting_stack:number;
 game_type:'nlh'|'plo'|'mixed';location:string|null};
export type ScheduleBatchRequest={p_expected_actor_id:string;p_request_id:string;p_rows:ScheduleRow[]};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export class ScheduleBatchError extends Error {
 constructor(message:string,public readonly unknownOutcome=true){super(message);}
}
export const scheduleBatchJournalKey=(actor:string)=>`vinpoker:schedule-batch:v1:${actor}`;
export function readScheduleBatchJournal(raw:string,actor:string):ScheduleBatchRequest {
 const r:unknown=JSON.parse(raw);
 if(!object(r)||r.p_expected_actor_id!==actor||!uuid(actor)||!uuid(r.p_request_id)
  ||Object.keys(r).some(k=>!['p_expected_actor_id','p_request_id','p_rows'].includes(k))
  ||!Array.isArray(r.p_rows)||r.p_rows.length<1||r.p_rows.length>100)throw new ScheduleBatchError('SCHEDULE_JOURNAL_INVALID');
 for(const row of r.p_rows) {
  if(!object(row)||!uuid(row.club_id)||Object.keys(row).some(k=>!['club_id','name','start_time','buy_in','starting_stack','game_type','location'].includes(k))
   ||typeof row.name!=='string'||!row.name.trim()||typeof row.start_time!=='string'||!Number.isFinite(new Date(row.start_time).getTime())
   ||(row.location!==null&&typeof row.location!=='string'))throw new ScheduleBatchError('SCHEDULE_JOURNAL_INVALID');
  parseTournamentSchedule({tournaments:[{...row,venue:row.location}]});
 }
 return r as ScheduleBatchRequest;
}
export function persistScheduleBatchJournal(storage:Pick<Storage,'getItem'|'setItem'>,request:ScheduleBatchRequest) {
 const key=scheduleBatchJournalKey(request.p_expected_actor_id),encoded=canonicalVoiceJson(request);
 readScheduleBatchJournal(encoded,request.p_expected_actor_id);
 const prior=storage.getItem(key);
 if(prior!==null&&canonicalVoiceJson(readScheduleBatchJournal(prior,request.p_expected_actor_id))!==encoded)throw new ScheduleBatchError('SCHEDULE_JOURNAL_CHANGED');
 storage.setItem(key,encoded);if(storage.getItem(key)!==encoded)throw new ScheduleBatchError('SCHEDULE_JOURNAL_WRITE_FAILED');
}
export function settleScheduleBatchJournal(storage:Pick<Storage,'getItem'|'removeItem'>,request:ScheduleBatchRequest) {
 const key=scheduleBatchJournalKey(request.p_expected_actor_id),prior=storage.getItem(key);
 if(prior===null||canonicalVoiceJson(readScheduleBatchJournal(prior,request.p_expected_actor_id))!==canonicalVoiceJson(request))throw new ScheduleBatchError('SCHEDULE_JOURNAL_CHANGED');
 storage.removeItem(key);if(storage.getItem(key)!==null)throw new ScheduleBatchError('SCHEDULE_JOURNAL_CLEAR_FAILED');
}
export function resolveScheduleBatchResult(data:unknown,request:ScheduleBatchRequest):string[] {
 if(object(data)&&data.ok===false&&typeof data.error==='string')throw new ScheduleBatchError(data.error,false);
 if(!object(data)||data.ok!==true||data.actor_id!==request.p_expected_actor_id||data.request_id!==request.p_request_id
  ||data.count!==request.p_rows.length||!Array.isArray(data.tournaments)||data.tournaments.length!==request.p_rows.length)
  throw new ScheduleBatchError('SCHEDULE_RECEIPT_UNCONFIRMED');
 const ids=data.tournaments.map((t:unknown,i:number)=>{
  if(!object(t)||t.ok!==true||!uuid(t.tournament_id)||!uuid(t.request_id)||t.actor_id!==request.p_expected_actor_id
   ||t.club_id!==request.p_rows[i].club_id||t.level_count!==0)throw new ScheduleBatchError('SCHEDULE_RECEIPT_UNCONFIRMED');
  return t.tournament_id;
 });
 if(new Set(ids).size!==ids.length)throw new ScheduleBatchError('SCHEDULE_RECEIPT_UNCONFIRMED');
 return ids;
}
export function isScheduleBatchCancelled(data:unknown,request:ScheduleBatchRequest):boolean {
 return object(data)&&data.ok===true&&data.outcome==='cancelled'&&data.actor_id===request.p_expected_actor_id
  &&data.request_id===request.p_request_id&&data.count===request.p_rows.length;
}
export async function recoverScheduleBatch(rpc:Rpc,request:ScheduleBatchRequest):Promise<string[]> {
 try {
  const response=await waitForManualPlayerResponse(Promise.resolve(rpc('get_tournament_schedule_batch_receipt_v1',{...request})));
  if(response.error)throw response.error;
  return isScheduleBatchCancelled(response.data,request)?[]:resolveScheduleBatchResult(response.data,request);
 }catch {throw new ScheduleBatchError('SCHEDULE_OUTCOME_UNKNOWN');}
}
/** A cancellation either returns the prior commit or a durable zero-create tombstone. */
export async function cancelScheduleBatch(rpc:Rpc,request:ScheduleBatchRequest):Promise<string[]> {
 let response:{data:unknown;error:unknown};
 try {response=await waitForManualPlayerResponse(Promise.resolve(rpc('cancel_tournament_schedule_batch_v1',{...request})));}
 catch {return recoverScheduleBatch(rpc,request);}
 if(response.error)return recoverScheduleBatch(rpc,request);
 return isScheduleBatchCancelled(response.data,request)?[]:resolveScheduleBatchResult(response.data,request);
}
export async function createScheduleBatch(rpc:Rpc,request:ScheduleBatchRequest):Promise<string[]> {
 let response:{data:unknown;error:unknown};
 try {response=await waitForManualPlayerResponse(Promise.resolve(rpc('create_tournament_schedule_batch_v1',{...request})));}
 catch {return recoverScheduleBatch(rpc,request);}
 if(response.error)return recoverScheduleBatch(rpc,request);
 return resolveScheduleBatchResult(response.data,request);
}

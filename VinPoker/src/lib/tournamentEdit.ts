import {z} from 'zod';
import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';
import {waitForManualPlayerResponse} from './floorManualPlayerIntent';

const money=z.number().nonnegative().safe().int();
export const tournamentEditConfigSchema=z.object({
 name:z.string().trim().min(1),start_time:z.string().datetime({offset:true}),
 buy_in:money,rake_amount:money,service_fee_amount:money,guarantee_amount:money.nullable(),starting_stack:money.positive(),
 location:z.string().nullable(),description:z.string().nullable(),game_type:z.string().min(1),
 minutes_per_level:money.positive(),late_reg_close_level:money,
}).strict();
const levelSchema=z.object({level_number:money.positive(),small_blind:money,big_blind:money,ante:money,duration_minutes:money,is_break:z.boolean()});
const stateSchema=z.object({config:tournamentEditConfigSchema,
 levels:z.array(levelSchema.extend({id:z.string().uuid(),tournament_id:z.string().uuid()}).passthrough()),
 lifecycle:z.object({club_id:z.string().uuid(),status:z.string(),live_status:z.string()}).passthrough(),
}).strict();
export type TournamentEditConfig=z.infer<typeof tournamentEditConfigSchema>;
export type TournamentEditState=z.infer<typeof stateSchema>;
const requestSchema=z.object({p_tournament_id:z.string().uuid(),p_club_id:z.string().uuid(),p_expected_actor_id:z.string().uuid(),p_request_id:z.string().uuid(),
 p_expected_state:stateSchema,p_config:tournamentEditConfigSchema,p_levels:z.array(levelSchema.strict()).min(1).nullable(),
}).strict();
export type TournamentEditRequest=z.infer<typeof requestSchema>;
export type TournamentEditContext={state:TournamentEditState;canEditBlinds:boolean};
export type TournamentEditRpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export class TournamentEditError extends Error{
 constructor(public readonly code:string,public readonly unknownOutcome=false){super(code);}
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const inScope=(state:TournamentEditState,tour:string,club:string)=>state.lifecycle.club_id===club&&state.levels.every(row=>row.tournament_id===tour);
const bounded=<T>(response:PromiseLike<T>)=>waitForManualPlayerResponse(Promise.resolve(response));
const businessErrors=new Set(['actor_changed','actor_not_allowed','invalid_edit_request','invalid_edit_fields','invalid_edit_number','invalid_blind_levels',
 'blind_levels_not_allowed','IDEMPOTENCY_CONFLICT','tournament_not_found','tournament_not_open','stale_edit_context']);

export async function loadTournamentEditContext(rpc:TournamentEditRpc,tour:string,club:string,actor:string):Promise<TournamentEditContext>{
 const {data,error}=await bounded(rpc('get_tournament_edit_context_v1',{p_tournament_id:tour,p_expected_actor_id:actor}));
 if(error||!object(data)||data.ok!==true||data.tournament_id!==tour||data.club_id!==club||data.actor_id!==actor||typeof data.can_edit_blinds!=='boolean')
  throw new TournamentEditError('context_unavailable');
 const state=stateSchema.parse(data.state);
 if(!inScope(state,tour,club))throw new TournamentEditError('context_unavailable');
 return {state,canEditBlinds:data.can_edit_blinds};
}
export const tournamentEditJournalKey=(actor:string,club:string,tour:string)=>`vinpoker:tournament-edit:v1:${actor}:${club}:${tour}`;
export function parseTournamentEditRequest(value:unknown,actor:string,club:string,tour:string):TournamentEditRequest{
 const r=requestSchema.parse(value);
 if(r.p_expected_actor_id!==actor||r.p_club_id!==club||r.p_tournament_id!==tour||!inScope(r.p_expected_state,tour,club))throw new TournamentEditError('journal_invalid',true);
 if(r.p_levels?.some((l,i)=>l.level_number!==i+1||l.duration_minutes<=0||(!l.is_break&&l.big_blind<=0)))throw new TournamentEditError('invalid_blind_levels');
 return r;
}
export function readTournamentEditJournal(raw:string,actor:string,club:string,tour:string):TournamentEditRequest{
 try{return parseTournamentEditRequest(JSON.parse(raw),actor,club,tour);}catch{throw new TournamentEditError('journal_invalid',true);}
}
export function retainTournamentEdit(storage:Pick<Storage,'getItem'|'setItem'>,request:TournamentEditRequest){
 const key=tournamentEditJournalKey(request.p_expected_actor_id,request.p_club_id,request.p_tournament_id),old=storage.getItem(key),serialized=canonicalVoiceJson(request);
 if(old!==null&&canonicalVoiceJson(readTournamentEditJournal(old,request.p_expected_actor_id,request.p_club_id,request.p_tournament_id))!==serialized)throw new TournamentEditError('journal_changed',true);
 storage.setItem(key,serialized);if(storage.getItem(key)!==serialized)throw new TournamentEditError('journal_unavailable',true);
}
export function clearTournamentEdit(storage:Pick<Storage,'getItem'|'removeItem'>,request:TournamentEditRequest){
 const key=tournamentEditJournalKey(request.p_expected_actor_id,request.p_club_id,request.p_tournament_id);
 verifyRetainedTournamentEdit(storage,request);
 storage.removeItem(key);if(storage.getItem(key)!==null)throw new TournamentEditError('journal_unavailable',true);
}
export function verifyRetainedTournamentEdit(storage:Pick<Storage,'getItem'>,request:TournamentEditRequest){
 const key=tournamentEditJournalKey(request.p_expected_actor_id,request.p_club_id,request.p_tournament_id),old=storage.getItem(key);
 if(old===null||canonicalVoiceJson(readTournamentEditJournal(old,request.p_expected_actor_id,request.p_club_id,request.p_tournament_id))!==canonicalVoiceJson(request))throw new TournamentEditError('journal_changed',true);
}
function receipt(data:unknown,r:TournamentEditRequest):TournamentEditState{
 if(object(data)&&data.ok===false&&typeof data.error==='string'&&businessErrors.has(data.error))throw new TournamentEditError(data.error);
 if(!object(data)||data.ok!==true||data.tournament_id!==r.p_tournament_id||data.club_id!==r.p_club_id||data.actor_id!==r.p_expected_actor_id||data.request_id!==r.p_request_id)
  throw new TournamentEditError('receipt_unverified',true);
 const parsed=stateSchema.safeParse(data.state);
 if(!parsed.success||!inScope(parsed.data,r.p_tournament_id,r.p_club_id))throw new TournamentEditError('receipt_unverified',true);
 const state=parsed.data;
 const normalize=(config:TournamentEditConfig)=>({...config,name:config.name.trim(),start_time:new Date(config.start_time).toISOString()});
 if(canonicalVoiceJson(normalize(state.config))!==canonicalVoiceJson(normalize(r.p_config)))throw new TournamentEditError('receipt_unverified',true);
 if(r.p_levels===null){if(canonicalVoiceJson(state.levels)!==canonicalVoiceJson(r.p_expected_state.levels))throw new TournamentEditError('receipt_unverified',true);}
 else if(canonicalVoiceJson(state.levels.map(row=>levelSchema.parse(row)))!==canonicalVoiceJson(r.p_levels))throw new TournamentEditError('receipt_unverified',true);
 return state;
}
export async function recoverTournamentEdit(rpc:TournamentEditRpc,request:TournamentEditRequest):Promise<TournamentEditState>{
 try{const response=await bounded(rpc('get_tournament_edit_receipt_v1',{...request}));
  if(response.error)throw new Error('unavailable');return receipt(response.data,request);
 }catch{throw new TournamentEditError('receipt_unverified',true);}
}
export async function submitTournamentEdit(rpc:TournamentEditRpc,request:TournamentEditRequest):Promise<TournamentEditState>{
 let response:{data:unknown;error:unknown};
 try{response=await bounded(rpc('edit_tournament_with_levels_v1',{...request}));}catch{return recoverTournamentEdit(rpc,request);}
 if(response.error){
  const code=object(response.error)?response.error.code:null;
  if(typeof code==='string'&&['42501','P0001','22P02','22003','22007','22023','23502','23503','23505','23514','40P01','55P03'].includes(code))throw new TournamentEditError('statement_rejected');
  return recoverTournamentEdit(rpc,request);
 }
 try{return receipt(response.data,request);}catch(error){
  if(error instanceof TournamentEditError&&!error.unknownOutcome)throw error;
  return recoverTournamentEdit(rpc,request);
 }
}

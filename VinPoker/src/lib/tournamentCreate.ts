import type {BlindLevel} from './blindPresets';

export type TournamentCreateRequest={
  p_club_id:string; p_expected_actor_id:string; p_request_id:string;
  p_config:Record<string,unknown>; p_levels:BlindLevel[];
};
export type TournamentCreateKind='single'|'multi';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export class TournamentCreateError extends Error {
  constructor(message:string,public readonly unknownOutcome=false){super(message);}
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const tournamentCreateJournalKey=(actor:string,club:string,kind:TournamentCreateKind='single')=>
  kind==='multi'?`vinpoker:main-event-create:v1:${actor}:${club}`:`vinpoker:tournament-create:v1:${actor}:${club}`;
export function readTournamentCreateJournal(raw:string,actor:string,club:string,kind:TournamentCreateKind='single'):TournamentCreateRequest {
  const r:unknown=JSON.parse(raw);
  if(!object(r)||r.p_expected_actor_id!==actor||r.p_club_id!==club||!uuid(r.p_request_id)
    ||!object(r.p_config)||!Array.isArray(r.p_levels))throw new TournamentCreateError('Invalid pending create request',true);
  if(kind==='multi'&&(!Number.isInteger(r.p_config.flight_count)||Number(r.p_config.flight_count)<1||Number(r.p_config.flight_count)>11))
    throw new TournamentCreateError('Invalid pending Main Event request',true);
  return r as unknown as TournamentCreateRequest;
}
function result(data:unknown,request:TournamentCreateRequest,kind:TournamentCreateKind):string {
  if(object(data)&&data.ok===false&&typeof data.error==='string')throw new TournamentCreateError(data.error);
  if(!object(data)||data.ok!==true||data.actor_id!==request.p_expected_actor_id
    ||data.club_id!==request.p_club_id||data.request_id!==request.p_request_id
    ||data.level_count!==request.p_levels.length)throw new TournamentCreateError('Create outcome is not verified',true);
  if(kind==='multi'){
    if(!uuid(data.event_id)||!uuid(data.final_tournament_id)||data.event_id===data.final_tournament_id
      ||data.flight_count!==request.p_config.flight_count)throw new TournamentCreateError('Main Event outcome is not verified',true);
    return data.event_id;
  }
  if(!uuid(data.tournament_id))throw new TournamentCreateError('Create outcome is not verified',true);
  return data.tournament_id;
}
async function bounded<T>(response:PromiseLike<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve(response),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new TournamentCreateError('Create outcome is not verified',true)),20_000);
  })]);}finally{clearTimeout(timer);}
}
/** Read the exact actor/payload receipt. A missing/denied read is not rollback proof. */
export async function recoverTournamentCreate(rpc:Rpc,request:TournamentCreateRequest,kind:TournamentCreateKind='single'):Promise<string>{
  try{
    const response=await bounded(rpc(kind==='multi'?'get_tournament_event_create_receipt_v1':'get_tournament_create_receipt_v1',{...request}));
    if(response.error)throw new Error('receipt unavailable');
    return result(response.data,request,kind);
  }catch{throw new TournamentCreateError('Create outcome is not verified; check the previous request',true);}
}
/** One writer only. Transport errors reconcile by receipt, never by a new key. */
export async function createTournament(rpc:Rpc,request:TournamentCreateRequest,kind:TournamentCreateKind='single'):Promise<string>{
  let response:{data:unknown;error:unknown};
  try{response=await bounded(rpc(kind==='multi'?'create_tournament_event_with_flights_v2':'create_tournament_with_levels_v1',{...request}));}
  catch{return recoverTournamentCreate(rpc,request,kind);}
  if(response.error){
    const error=response.error as {code?:string;message?:string};
    if(['42501','P0001','22P02','22003','23502','23503','23505','23514'].includes(error.code??''))
      throw new TournamentCreateError(error.message??error.code!);
    return recoverTournamentCreate(rpc,request,kind);
  }
  return result(response.data,request,kind);
}

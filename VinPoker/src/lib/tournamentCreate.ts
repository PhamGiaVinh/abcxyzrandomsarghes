import type {BlindLevel} from './blindPresets';

export type TournamentCreateRequest={
  p_club_id:string; p_expected_actor_id:string; p_request_id:string;
  p_config:Record<string,unknown>; p_levels:BlindLevel[];
};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export class TournamentCreateError extends Error {
  constructor(message:string,public readonly unknownOutcome=false){super(message);}
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const tournamentCreateJournalKey=(actor:string,club:string)=>`vinpoker:tournament-create:v1:${actor}:${club}`;
export function readTournamentCreateJournal(raw:string,actor:string,club:string):TournamentCreateRequest {
  const r:unknown=JSON.parse(raw);
  if(!object(r)||r.p_expected_actor_id!==actor||r.p_club_id!==club||!uuid(r.p_request_id)
    ||!object(r.p_config)||!Array.isArray(r.p_levels))throw new TournamentCreateError('Invalid pending create request',true);
  return r as unknown as TournamentCreateRequest;
}
function result(data:unknown,request:TournamentCreateRequest):string {
  if(object(data)&&data.ok===false&&typeof data.error==='string')throw new TournamentCreateError(data.error);
  if(!object(data)||data.ok!==true||!uuid(data.tournament_id)||data.actor_id!==request.p_expected_actor_id
    ||data.club_id!==request.p_club_id||data.request_id!==request.p_request_id
    ||data.level_count!==request.p_levels.length)throw new TournamentCreateError('Create outcome is not verified',true);
  return data.tournament_id;
}
async function bounded<T>(response:PromiseLike<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve(response),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new TournamentCreateError('Create outcome is not verified',true)),20_000);
  })]);}finally{clearTimeout(timer);}
}
/** Read the exact actor/payload receipt. A missing/denied read is not rollback proof. */
export async function recoverTournamentCreate(rpc:Rpc,request:TournamentCreateRequest):Promise<string>{
  try{
    const response=await bounded(rpc('get_tournament_create_receipt_v1',{...request}));
    if(response.error)throw new Error('receipt unavailable');
    return result(response.data,request);
  }catch{throw new TournamentCreateError('Create outcome is not verified; check the previous request',true);}
}
/** One writer only. Transport errors reconcile by receipt, never by a new key. */
export async function createTournament(rpc:Rpc,request:TournamentCreateRequest):Promise<string>{
  let response:{data:unknown;error:unknown};
  try{response=await bounded(rpc('create_tournament_with_levels_v1',{...request}));}
  catch{return recoverTournamentCreate(rpc,request);}
  if(response.error){
    const error=response.error as {code?:string;message?:string};
    if(['42501','P0001','22P02','22003','23502','23503','23505','23514'].includes(error.code??''))
      throw new TournamentCreateError(error.message??error.code!);
    return recoverTournamentCreate(rpc,request);
  }
  return result(response.data,request);
}

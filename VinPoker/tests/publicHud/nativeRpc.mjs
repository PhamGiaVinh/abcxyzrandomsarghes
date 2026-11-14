import {sqlAsync,service} from './nativeDb.mjs';
const signatures={
 claim_public_hud_jobs_v1:['p_limit'],claim_public_hud_jobs_with_source_v1:['p_limit'],get_public_hud_job_source_v1:['p_kind','p_entity','p_generation','p_lease'],
 publish_public_hud_hand_v1:['p_entity','p_generation','p_lease','p_fingerprint','p_rows'],
 process_public_hud_metadata_v1:['p_kind','p_entity','p_generation','p_lease'],
 fail_public_hud_job_v1:['p_kind','p_entity','p_generation','p_lease','p_error'],
 absorb_public_spectator_generations_v2:['p_limit'],flush_public_spectator_broadcast_v2:['p_limit'],
 claim_public_spectator_projection_v2:['p_limit'],
 get_public_spectator_projection_source_v2:['p_tournament_id','p_component','p_fencing_token'],
 get_public_spectator_projection_sources_v2:['p_jobs'],
 publish_public_spectator_projection_v2:['p_tournament_id','p_component','p_group_key','p_fencing_token','p_source_vector','p_payload'],
 fail_public_spectator_projection_v2:['p_tournament_id','p_component','p_group_key','p_fencing_token','p_error'],
};
const quote=value=>value===null?'NULL':`'${String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")}'`;
export function createNativeWorkerClient(execute=sqlAsync){return {async rpc(name,args){
 if(!Object.hasOwn(signatures,name))throw Error('Native fixture RPC not allowed');
 const values=signatures[name].map(key=>{if(args[key]===undefined)throw Error('Missing fixture RPC argument');return quote(args[key]);});
 try{return {data:JSON.parse(await execute(`${service} SET statement_timeout='5s';SELECT coalesce(to_jsonb(public.${name}(${values.join(',')})),'null'::jsonb);`)),error:null};}
 catch(error){return {data:null,error:String(error)};}
}};}
export const nativeWorkerClient=createNativeWorkerClient();

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {HistoricalDisplayVerificationError,verifyHistoricalDisplaySettlement} from '../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';
import {normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';

// Actual user-triggered display verifier, not the queue worker. All HTTP/Auth is
// modeled locally; source snapshot/verifier/commit/receipt and ACL run on PG17.
export function createHistoricalDisplayBrowser({sql,query,fixture,actor,log}){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),
  'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
 assert.ok(uuid(actor)&&uuid(fixture.tour));
 const role='display_browser_'+randomUUID().replaceAll('-','');
 sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
 const service=q=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='service_role';
  SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE ${role};${q}COMMIT;`));
 const quote=value=>value===null?'NULL':`'${(typeof value==='object'?JSON.stringify(value):String(value)).replaceAll("'","''")}'`;
 const types={
  get_tracker_historical_display_snapshot:{p_hand_id:'uuid',p_tournament_id:'uuid'},
  get_tracker_historical_display_commit_receipt:{p_hand_id:'uuid',p_tournament_id:'uuid',p_actor_user_id:'uuid',p_idempotency_key:'text',
   p_expected_source_revision:'bigint',p_expected_source_chain_hash:'text',p_expected_outcome_hash:'text'},
  resolve_tracker_historical_display_intent_v1:{p_hand_id:'uuid',p_tournament_id:'uuid',p_actor_user_id:'uuid',p_idempotency_key:'text',
   p_expected_source_revision:'bigint',p_expected_source_chain_hash:'text',p_expected_outcome_hash:'text'},
  commit_tracker_historical_display_outcome_v2:{p_hand_id:'uuid',p_actor_user_id:'uuid',p_actor_kind:'text',p_expected_source_revision:'bigint',
   p_expected_source_chain_hash:'text',p_outcome_hash:'text',p_request_hash:'text',p_idempotency_key:'text',p_public_outcome:'jsonb',p_lease_token:'uuid'},
 };
 const user={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(name,args)=>{
  assert.equal(name,'authorize_tournament_live_resettle');assert.deepEqual({...args},{p_tournament_id:fixture.tour});
  return {data:query(`SELECT to_jsonb(public.authorize_tournament_live_resettle('${fixture.tour}'));`),error:null};
 }};
 let activeHand;
 const admin={rpc:async(name,args)=>{
  const schema=types[name];assert.ok(schema,'unexpected display RPC');
  assert.deepEqual(Object.keys(args).sort(),Object.keys(schema).sort());
  assert.equal(args.p_hand_id,activeHand);if('p_tournament_id' in args)assert.equal(args.p_tournament_id,fixture.tour);
  if('p_actor_user_id' in args)assert.equal(args.p_actor_user_id,actor);
  if(name==='commit_tracker_historical_display_outcome_v2'){assert.equal(args.p_actor_kind,'owner_admin');assert.equal(args.p_lease_token,null);}
  const params=Object.entries(args).map(([key,value])=>`${key}=>${quote(value)}::${schema[key]}`).join(',');
  try{
   const data=service(`SELECT coalesce(to_jsonb(public.${name}(${params})),'null'::jsonb);`);
   log.push({displayRpc:name,handId:activeHand,status:data?.status??(data?.ok?'ok':'read')});
   return {data,error:null};
  }catch(error){
   const message=String(error?.stderr??'').match(/^ERROR:\s+([a-z][a-z0-9_]{2,100})\s*$/m)?.[1]??'local_display_rpc_failed';
   log.push({displayRpc:name,handId:activeHand,status:'error',code:message});return {data:null,error:{message}};
  }
 },from:table=>{
  assert.equal(table,'tournament_settlement_outcomes');let hand;
  const q={select:columns=>{assert.equal(columns,'settlement_revision');return q;},eq:(key,value)=>{
   assert.equal(key,'hand_id');assert.equal(value,activeHand);hand=value;return q;},
   order:(key,options)=>{assert.equal(key,'settlement_revision');assert.equal(options.ascending,false);return q;},
   limit:async n=>{assert.equal(n,1);return {data:service(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(
    SELECT settlement_revision FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' ORDER BY settlement_revision DESC LIMIT 1)x;`),error:null};}};
  return q;
 }};
 let handler;
 const source=stripTypeScriptTypes(readFileSync('supabase/functions/tournament-historical-settlement/index.ts','utf8')
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
 runInNewContext(source,{Request,Response,TextEncoder,crypto:webcrypto,console,
  HistoricalDisplayVerificationError,verifyHistoricalDisplaySettlement,canonicalJsonV1,normalizeSettlementSourceRpcResult,
  handleOptions:()=>null,jsonResp:(_req,value,status=200)=>new Response(JSON.stringify(value),{status}),
  createClient:(_url,key)=>key==='LOCAL_DISPLAY_ANON'?user:((assert.equal(key,'LOCAL_DISPLAY_SERVICE')),admin),
  Deno:{env:{get:key=>({SUPABASE_URL:'http://127.0.0.1:54329',SUPABASE_ANON_KEY:'LOCAL_DISPLAY_ANON',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_DISPLAY_SERVICE'})[key]},serve:fn=>{handler=fn;}},
 });
 let flight=false;
 return {
  async invoke(body){
   assert.equal(flight,false,'one display operation at a time in this local scope');
   assert.ok(['preview','commit','receipt','resolve'].includes(body.mode)&&body.tournament_id===fixture.tour&&uuid(body.hand_id));
   // Scope is derived from this server's successful start log, never browser data.
   assert.ok(log.some(row=>row.edgeRpc==='start_tracker_hand_v3'&&row.status==='success'&&row.handId===body.hand_id),'only hands created in this local browser run');
   assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${body.hand_id}'
    AND tournament_id='${fixture.tour}' AND created_by='${actor}' AND status='completed' AND NOT is_voided));`),true);
   activeHand=body.hand_id;flight=true;
   try{
    const response=await handler(new Request('http://127.0.0.1:54329/functions/v1/tournament-historical-settlement',{
     method:'POST',headers:{authorization:'Bearer LOCAL_VERIFIED_SESSION','content-type':'application/json'},body:JSON.stringify(body)}));
    const result=await response.json();log.push({displayMode:body.mode,handId:body.hand_id,status:response.status,result:result.status??result.code??'error'});
    return {status:response.status,body:result};
   }finally{flight=false;activeHand=undefined;}
  },
  dispose(){sql(`DROP ROLE ${role};`);},
 };
}

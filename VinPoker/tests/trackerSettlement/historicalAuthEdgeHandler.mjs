// Actual handler/Auth authorization branches; synthetic Auth/RPC and CORS adapter.
// No settlement computation or database commit is asserted by this harness.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=stripTypeScriptTypes(readFileSync('supabase/functions/tournament-historical-settlement/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
const actor='81100000-0000-4000-8000-000000000001';
const intent={mode:'commit',expected_actor_id:actor,tournament_id:'85000000-0000-4000-8000-000000000001',hand_id:'86000000-0000-4000-8000-000000000001',idempotency_key:'historical-auth-test-0001',expected_source_revision:1,expected_source_chain_hash:'a'.repeat(64),expected_outcome_hash:'b'.repeat(64)};
const storedReceipt={ok:true,idempotent:true,settlement_revision:1,source_revision:1,outcome_hash:'b'.repeat(64)};
async function request({body=intent,receipt=storedReceipt,receiptError=null,resolution=null,resolutionThrows=false,authError=null,authThrows=false,userPresent=true,authorized=true,authorizationError=null,authorizationThrows=false,header=true}={}){
 let handler;const calls=[],clients=[];
 runInNewContext(source,{Request,Response,console,HistoricalDisplayVerificationError:class extends Error{},
  handleOptions:()=>null,jsonResp:(_req,value,status=200)=>new Response(JSON.stringify(value),{status}),
  Deno:{serve:fn=>{handler=fn;},env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[key]}},
  createClient:(_url,key,options)=>{clients.push({key,options});return {
   auth:{getUser:async()=>{if(authThrows)throw Error('auth unavailable');return {data:{user:userPresent?{id:actor}:null},error:authError};}},
   rpc:async(name,params)=>{calls.push({key,name,params});if(name==='authorize_tournament_live_resettle'){
    if(authorizationThrows)throw Error('authorization unavailable');return {data:authorized,error:authorizationError};}
    if(name==='resolve_tracker_historical_display_intent_v1'){if(resolutionThrows)throw Error('transport');return {data:resolution,error:receiptError};}
    assert.equal(name,'get_tracker_historical_display_commit_receipt');return {data:receipt,error:receiptError};},
  };},
 });
 const response=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(header?{Authorization:'Bearer synthetic-user'}:{})},body:JSON.stringify(body)}));
 return {status:response.status,payload:await response.json(),calls,clients};
}
const good=await request();assert.equal(good.status,200);assert.equal(good.clients.length,2);
assert.equal(good.calls[0].key,'synthetic-anon');assert.equal(good.calls[0].name,'authorize_tournament_live_resettle');
assert.equal(good.calls[1].params.p_actor_user_id,actor);assert.equal(good.calls[1].key,'synthetic-service');
for(const authError of [{status:503},{status:429},{status:0},{message:'unknown'}]){
 const result=await request({authError});assert.equal(result.status,503);assert.equal(result.calls.length,0);assert.equal(result.clients.length,1);
 const absent=await request({authError,userPresent:false});assert.equal(absent.status,503);assert.equal(absent.calls.length,0);
}
assert.equal((await request({authThrows:true})).status,503);
for(const status of [400,401,403,422]){const denied=await request({authError:{status}});assert.equal(denied.status,401);assert.equal(denied.calls.length,0);}
assert.equal((await request({userPresent:false})).status,401);assert.equal((await request({header:false})).clients.length,0);
for(const failure of [{authorizationError:{code:'08006'}},{authorizationThrows:true}]){
 const result=await request(failure);assert.equal(result.status,503);assert.equal(result.clients.length,1);assert.equal(result.calls.length,1);
}
const denied=await request({authorized:false});assert.equal(denied.status,403);assert.equal(denied.clients.length,1);
for(const authorized of [null,0,'true',{}]){const malformed=await request({authorized});assert.equal(malformed.status,503);assert.equal(malformed.clients.length,1);}
const readBody={...intent,mode:'receipt'};
const recovered=await request({body:readBody});assert.equal(recovered.status,200);assert.equal(recovered.payload.status,'receipt_found');
assert.deepEqual(recovered.payload.receipt,storedReceipt);assert.equal(recovered.payload.actor_id,actor);assert.equal(recovered.payload.idempotency_key,intent.idempotency_key);
assert.deepEqual(recovered.calls.map(call=>call.name),['authorize_tournament_live_resettle','get_tracker_historical_display_commit_receipt']);
const missing=await request({body:readBody,receipt:null});assert.equal(missing.status,200);assert.equal(missing.payload.status,'receipt_not_found');
for(const patch of [{expected_actor_id:undefined},{expected_source_revision:0},{expected_source_chain_hash:'bad'},{expected_outcome_hash:'bad'},{idempotency_key:'short'}]){
 const invalid=await request({body:{...readBody,...patch}});assert.equal(invalid.status,400);assert.equal(invalid.calls.length,0);
}
const actorMismatch=await request({body:{...readBody,expected_actor_id:'other-actor'}});assert.equal(actorMismatch.status,409);assert.equal(actorMismatch.calls.length,0);
for(const receipt of [{},{...storedReceipt,source_revision:2},{...storedReceipt,outcome_hash:'c'.repeat(64)},{...storedReceipt,settlement_revision:0}]){
 const malformed=await request({body:readBody,receipt});assert.equal(malformed.status,502);assert.equal(malformed.calls.length,2);
}
assert.equal((await request({body:readBody,receiptError:{message:'backend unavailable'}})).status,503);
assert.equal((await request({body:readBody,receiptError:{message:'idempotency_mismatch'}})).status,409);
console.log('HISTORICAL_EDGE_AUTH_AUTHORIZATION_UNAVAILABLE_FAIL_CLOSED_PASS');
const resolveBody={...intent,mode:'resolve'};
const resolvedEnvelope={ok:true,status:'intent_obsolete',actor_id:actor,tournament_id:intent.tournament_id,
 hand_id:intent.hand_id,idempotency_key:intent.idempotency_key,source_revision:1,
 source_chain_hash:intent.expected_source_chain_hash,outcome_hash:intent.expected_outcome_hash,current_source_revision:2,receipt:null};
const obsolete=await request({body:resolveBody,resolution:resolvedEnvelope});assert.equal(obsolete.status,200);
assert.deepEqual(obsolete.payload,resolvedEnvelope);
assert.deepEqual(obsolete.calls.map(call=>call.name),['authorize_tournament_live_resettle','resolve_tracker_historical_display_intent_v1']);
for(const state of [{status:'receipt_found',receipt:storedReceipt,current_source_revision:2},
 {status:'receipt_not_found',receipt:null,current_source_revision:1}]){
 const result=await request({body:resolveBody,resolution:{...resolvedEnvelope,...state}});assert.equal(result.status,200);
 assert.equal(result.payload.status,state.status);
}
for(const patch of [{actor_id:'other-actor'},{tournament_id:'other-tour'},{hand_id:'other-hand'},
 {idempotency_key:'different-original-key'},{source_revision:2},{source_chain_hash:'c'.repeat(64)},
 {outcome_hash:'c'.repeat(64)},{current_source_revision:1},{receipt:{}},{status:'unknown'},{current_source_revision:null}]){
 const bad=await request({body:resolveBody,resolution:{...resolvedEnvelope,...patch}});assert.equal(bad.status,502);
}
for(const patch of [{expected_actor_id:undefined},{expected_source_revision:0},{expected_source_chain_hash:'bad'},
 {idempotency_key:'x'.repeat(256)}]){
 const invalid=await request({body:{...resolveBody,...patch}});assert.equal(invalid.status,400);assert.equal(invalid.calls.length,0);
}
assert.equal((await request({body:{...resolveBody,expected_actor_id:'other-actor'}})).status,409);
assert.equal((await request({body:resolveBody,receiptError:{message:'lock timeout'}})).status,503);
assert.equal((await request({body:resolveBody,receiptError:{message:'actor_not_authorized'}})).status,403);
assert.equal((await request({body:resolveBody,receiptError:{message:'idempotency_mismatch'}})).status,409);
assert.equal((await request({body:resolveBody,resolutionThrows:true})).status,503);
const authResolve=await request({body:resolveBody,authError:{status:503}});assert.equal(authResolve.status,503);assert.equal(authResolve.calls.length,0);
const deniedResolve=await request({body:resolveBody,authorized:false});assert.equal(deniedResolve.status,403);assert.equal(deniedResolve.calls.length,1);
const sanitized=await request({body:resolveBody,resolution:{...resolvedEnvelope,privateEvidence:'must-not-escape'}});
assert.equal(sanitized.status,200);assert.deepEqual(sanitized.payload,resolvedEnvelope);
console.log('HISTORY99_EDGE_STRICT_RESOLUTION_WITHOUT_VERIFIER_OR_WRITER_PASS');

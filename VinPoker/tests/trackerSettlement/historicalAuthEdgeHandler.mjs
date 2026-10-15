// Actual handler/Auth authorization branches; synthetic Auth/RPC and CORS adapter.
// No settlement computation or database commit is asserted by this harness.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=stripTypeScriptTypes(readFileSync('supabase/functions/tournament-historical-settlement/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
const actor='81100000-0000-4000-8000-000000000001';
const intent={mode:'commit',tournament_id:'85000000-0000-4000-8000-000000000001',hand_id:'86000000-0000-4000-8000-000000000001',idempotency_key:'historical-auth-test-0001',expected_source_revision:1,expected_source_chain_hash:'a'.repeat(64),expected_outcome_hash:'b'.repeat(64)};
async function request({authError=null,authThrows=false,userPresent=true,authorized=true,authorizationError=null,authorizationThrows=false,header=true}={}){
 let handler;const calls=[],clients=[];
 runInNewContext(source,{Request,Response,console,HistoricalDisplayVerificationError:class extends Error{},
  handleOptions:()=>null,jsonResp:(_req,value,status=200)=>new Response(JSON.stringify(value),{status}),
  Deno:{serve:fn=>{handler=fn;},env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[key]}},
  createClient:(_url,key,options)=>{clients.push({key,options});return {
   auth:{getUser:async()=>{if(authThrows)throw Error('auth unavailable');return {data:{user:userPresent?{id:actor}:null},error:authError};}},
   rpc:async(name,params)=>{calls.push({key,name,params});if(name==='authorize_tournament_live_resettle'){
    if(authorizationThrows)throw Error('authorization unavailable');return {data:authorized,error:authorizationError};}
    assert.equal(name,'get_tracker_historical_display_commit_receipt');return {data:{syntheticReceipt:true},error:null};},
  };},
 });
 const response=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(header?{Authorization:'Bearer synthetic-user'}:{})},body:JSON.stringify(intent)}));
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
console.log('HISTORICAL_EDGE_AUTH_AUTHORIZATION_UNAVAILABLE_FAIL_CLOSED_PASS');

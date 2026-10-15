// Executes the actual handler with synthetic Auth/RPC adapters. HTTP dispatch
// proof only: this does not prove Supabase Auth or a committed database write.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';

const raw=readFileSync('supabase/functions/tournament-live-update/index.ts','utf8');
const source=stripTypeScriptTypes(raw.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
const actor='81200000-0000-4000-8000-000000000001';
const intent={tournament_id:'85000000-0000-4000-8000-000000000001',action:'show_manual_cards_v1',
 hand_id:'86000000-0000-4000-8000-000000000001',table_session_id:'83500000-0000-4000-8000-000000000001',
 control_epoch:1,expected_source_revision:12,request_id:'manual-http-request-0001',
 player_hole_cards:[{player_id:'82000000-0000-4000-8000-000000000002',entry_number:1,hole_cards:['Qh','Qs']}],
 actor_id:'untrusted-body-actor'};
const receipt={status:'success',entry_count:1,hand_id:intent.hand_id,table_session_id:intent.table_session_id,
 control_epoch:1,request_key:intent.request_id,expected_source_revision:12,committed_source_revision:14};
async function request(body,{data=receipt,error=null,authenticated=true,header=true}={}){
 let handler;const calls=[];const clients=[];
 runInNewContext(source,{Request,Response,console,
  Deno:{env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon'})[key]},
   serve:callback=>{handler=callback;}},
  createClient:(url,key,options)=>{clients.push({url,key,options});return {
   auth:{getUser:async()=>({data:{user:authenticated?{id:actor}:null},error:authenticated?null:{status:401,message:'synthetic auth denied'}})},
   rpc:async(name,params)=>{calls.push({name,params});return {data,error};},
  };},
 });
 assert.equal(typeof handler,'function');
 const response=await handler(new Request('https://synthetic.invalid/functions/v1/tournament-live-update',{
  method:'POST',headers:{'Content-Type':'application/json',...(header?{Authorization:'Bearer synthetic-test-token'}:{})},
  body:JSON.stringify(body),
 }));
 return {status:response.status,payload:await response.json(),calls:JSON.parse(JSON.stringify(calls)),clients};
}
const good=await request(intent);
assert.equal(good.status,200);assert.deepEqual(good.payload.data,receipt);
assert.deepEqual(good.calls,[{name:'show_tracker_manual_cards_v1',params:{p_hand_id:intent.hand_id,
 p_session_id:intent.table_session_id,p_epoch:1,p_revision:12,p_request_key:intent.request_id,p_cards:intent.player_hole_cards}}]);
assert.equal(good.clients.length,1);assert.equal(good.clients[0].key,'synthetic-anon');
assert.equal(good.clients[0].options.global.headers.Authorization,'Bearer synthetic-test-token');
for(const patch of [{control_epoch:0},{expected_source_revision:-1},{request_id:'short'},{player_hole_cards:[]}]){
 const denied=await request({...intent,...patch});assert.equal(denied.status,422);assert.equal(denied.calls.length,0);
}
for(const options of [{header:false},{authenticated:false}]){
 const denied=await request(intent,options);assert.equal(denied.status,401);assert.equal(denied.calls.length,0);
}
const conflict=await request(intent,{data:{error:'idempotency_conflict'}});
assert.equal(conflict.status,409);assert.equal(conflict.calls.length,1);
const changedActor=await request({...intent,expected_actor_id:'different-actor'});
assert.equal(changedActor.status,422);assert.equal(changedActor.calls.length,0);
const read=await request({...intent,action:'get_manual_card_receipt_v1'},
 {data:{status:'not_found'}});
assert.equal(read.status,200);assert.deepEqual(read.calls,[{name:'get_tracker_manual_card_receipt_v1',params:{
 p_request_key:intent.request_id,p_expected_payload:{hand_id:intent.hand_id,table_session_id:intent.table_session_id,
  control_epoch:1,expected_source_revision:12,player_hole_cards:intent.player_hole_cards}}}]);
for(const data of [null,{}, {...receipt,hand_id:'another-hand'}, {...receipt,entry_count:0}]){
 const unknown=await request(intent,{data});
 assert.equal(unknown.status,502,'unknown/mismatched RPC proof must not become HTTP success');
 assert.equal(unknown.calls.length,1,'unknown outcomes must not trigger automatic writer retry');
}
console.log('MANUAL75_ACTUAL_EDGE_HANDLER_SYNTHETIC_AUTH_RPC_HTTP_PASS');

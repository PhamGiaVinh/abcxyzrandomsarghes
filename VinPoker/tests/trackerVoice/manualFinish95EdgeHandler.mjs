// Actual Edge handler with synthetic Auth/RPC only; real shared wire guards and
// side-pot reconciliation. Not deployed Auth, HTTP transport or DB commit proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {isManualFinishIntent,manualFinishReceiptMatches,manualFinishCancellationMatches} from '../../src/lib/trackerManualFinish.ts';
import {reconcileSidePots} from '../../supabase/functions/_shared/trackerEngine/validateAction.ts';
const source=stripTypeScriptTypes(readFileSync('supabase/functions/tournament-live-update/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
const actor='81400000-0000-4000-8000-000000000001';
const intent={actor_id:actor,request_id:'95000000-0000-4000-8000-000000000001',tournament_id:'85000000-0000-4000-8000-000000000001',
 tournament_table_id:'84000000-0000-4000-8000-000000000001',hand_id:'86000000-0000-4000-8000-000000000001',
 table_session_id:'83500000-0000-4000-8000-000000000001',control_epoch:1,source_revision:12,
 payload:{hand_time:'2026-10-16T00:00:00.000Z',players:[1,2].map(seat=>({player_id:`82000000-0000-4000-8000-00000000000${seat}`,entry_number:1,seat_number:seat,starting_stack:30000,ending_stack:30000,is_eliminated:false,hole_cards:[]})),actions:[],side_pots:[],community_cards:[],pot_size:0}};
const receipt={ok:true,status:'success',hand_id:intent.hand_id,actor_id:actor,request_id:intent.request_id,intent,
 table_session_id:intent.table_session_id,control_epoch:1,expected_source_revision:12,committed_source_revision:13,starting_total:60000,ending_total:60000};
const body={tournament_id:intent.tournament_id,action:'record_manual_hand_v1',finish_intent:intent};
async function request(value,{data=receipt,error=null,authenticated=true,header=true,authError=null,authThrows=false}={}){
 let handler;const calls=[],clients=[];
 runInNewContext(source,{Request,Response,console,isManualFinishIntent,manualFinishReceiptMatches,manualFinishCancellationMatches,reconcileSidePots,
  Deno:{env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon'})[key]},serve:callback=>{handler=callback;}},
  createClient:(url,key,options)=>{clients.push({url,key,options});return {auth:{getUser:async()=>{if(authThrows)throw new TypeError('synthetic auth transport failed');return {data:{user:authenticated?{id:actor}:null},error:authError};}},rpc:async(name,params)=>{calls.push({name,params});return {data,error};}};},
 });
 const response=await handler(new Request('https://synthetic.invalid/functions/v1/tournament-live-update',{method:'POST',
  headers:{'Content-Type':'application/json',...(header?{Authorization:'Bearer synthetic-test-token'}:{})},body:JSON.stringify(value)}));
 return {status:response.status,payload:await response.json(),calls:JSON.parse(JSON.stringify(calls)),clients};
}
const good=await request(body);assert.equal(good.status,200);assert.deepEqual(good.payload.data,receipt);
for(const authError of [{status:503},{status:0},{status:429},{message:'unknown auth failure'}]){
 const unavailable=await request(body,{authenticated:false,authError});
 assert.equal(unavailable.status,503);assert.equal(unavailable.calls.length,0);
 assert.equal(unavailable.payload.code,'authentication_unavailable');
}
const thrownAuth=await request(body,{authThrows:true});assert.equal(thrownAuth.status,503);assert.equal(thrownAuth.calls.length,0);
for(const status of [400,401,403,422])assert.equal((await request(body,{authenticated:false,authError:{status}})).status,401);
for(const action of ['start_hand','record_action','validate_voice_event','prepare_voice_finish','commit_voice_finish','commit_voice_board','commit_voice_hole_cards']){
 const unavailable=await request({...body,action},{authError:{status:503},authenticated:true});
 assert.equal(unavailable.status,503);assert.equal(unavailable.calls.length,0);assert.equal(unavailable.clients.length,1,'no privileged fallback client');
}
const cancelled={ok:true,status:'cancelled',actor_id:actor,request_id:intent.request_id,intent,hand_id:intent.hand_id,
 table_session_id:intent.table_session_id,control_epoch:1,expected_source_revision:12};
for(const action of ['record_manual_hand_v1','get_manual_finish_receipt_v1','cancel_manual_finish_v1']){
 const answer=await request({...body,action},{data:cancelled});assert.equal(answer.status,200);assert.deepEqual(answer.payload.data,cancelled);
 const mixed=await request({...body,action},{data:{...cancelled,committed_source_revision:13}});assert.equal(mixed.status,502);
}
const cancelRoute=await request({...body,action:'cancel_manual_finish_v1'},{data:cancelled});
assert.deepEqual(cancelRoute.calls,[{name:'cancel_tracker_manual_finish_v1',params:{p_intent:intent}}]);
assert.equal((await request({...body,action:'cancel_manual_finish_v1'})).status,200,'already committed proof remains success');
assert.equal((await request({...body,action:'cancel_manual_finish_v1',finish_intent:{...intent,actor_id:'81100000-0000-4000-8000-000000000001'}})).calls.length,0);
const legacy=await request({tournament_id:intent.tournament_id,action:'record_hand',table_id:intent.tournament_table_id,
 hand_number:1,...intent.payload});assert.equal(legacy.status,422);assert.equal(legacy.payload.code,'MANUAL_FINISH_CONTEXT_REQUIRED');assert.equal(legacy.calls.length,0);
assert.deepEqual(good.calls,[{name:'record_tracker_manual_hand_v1',params:{p_intent:intent}}]);
assert.equal(good.clients.length,1);assert.equal(good.clients[0].key,'synthetic-anon');assert.equal(good.clients[0].options.global.headers.Authorization,'Bearer synthetic-test-token');
const read=await request({...body,action:'get_manual_finish_receipt_v1'});assert.equal(read.status,200);
assert.deepEqual(read.calls,[{name:'get_tracker_manual_finish_receipt_v1',params:{p_intent:intent}}]);
const reordered={...receipt,intent:Object.fromEntries(Object.entries({...intent,payload:Object.fromEntries(Object.entries(intent.payload).reverse())}).reverse())};
assert.equal((await request(body,{data:reordered})).status,200,'JSONB object key ordering must not invalidate an exact receipt');
for(const patch of [{actor_id:'81100000-0000-4000-8000-000000000001'},{tournament_id:'85000000-0000-4000-8000-000000000002'},{request_id:'invalid'},{control_epoch:0},{source_revision:-1},{payload:{...intent.payload,players:[]}}]){
 const bad=await request({...body,finish_intent:{...intent,...patch}});assert.equal(bad.status,422);assert.equal(bad.calls.length,0);
}
const tampered=await request({...body,finish_intent:{...intent,payload:{...intent.payload,side_pots:[{amount:1,eligible_player_ids:[]}]}}});
assert.equal(tampered.status,422);assert.equal(tampered.calls.length,0);
for(const options of [{header:false},{authenticated:false}]){const bad=await request(body,options);assert.equal(bad.status,401);assert.equal(bad.calls.length,0);}
for(const action of ['record_manual_hand_v1','get_manual_finish_receipt_v1']){
 for(const error of ['IDEMPOTENCY_CONFLICT','stale_manual_finish_context','manual_finish_busy','receipt_not_found']){
  const bad=await request({...body,action},{data:{ok:false,error}});assert.equal(bad.status,409);assert.equal(bad.payload.code,error);assert.equal(bad.calls.length,1);
 }
 for(const data of [null,{}, {...receipt,hand_id:'another-hand'},{...receipt,intent:{...intent,payload:{...intent.payload,pot_size:1}}},{...receipt,committed_source_revision:12},{...receipt,ending_total:1}]){
  const bad=await request({...body,action},{data});assert.equal(bad.status,502);assert.equal(bad.calls.length,1,'no writer fallback or automatic retry');
 }
}
const rpcError=await request(body,{data:null,error:{message:'synthetic backend unavailable'}});assert.equal(rpcError.status,500);assert.equal(rpcError.calls.length,1);
const correction=await request(body,{data:null,error:{code:'P0001',message:'tracker_correction_pending'}});
assert.equal(correction.status,409);assert.equal(correction.payload.code,'tracker_correction_pending');assert.equal(correction.calls.length,1);
assert.equal((await request(body,{data:null,error:{code:'P0001',message:'some other error'}})).status,500);
assert.equal((await request(body,{data:null,error:{code:'08006',message:'tracker_correction_pending'}})).status,500);
console.log('MANUAL_FINISH95_ACTUAL_EDGE_HANDLER_GUARDS_RPC_ROUTING_PASS');

// Executes the actual Edge handler; Auth, RPC and query transports synthetic.
// No deployed HTTP/provider/DB write evidence is claimed by this harness.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';
const compile=text=>stripTypeScriptTypes(text.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
const source=compile(readFileSync('supabase/functions/assign-dealer/index.ts','utf8'));
const id=n=>`e1800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const intent={mode:'receipt',expected_actor_id:id(1),expected_club_id:id(2),table_id:id(3),table_session_id:id(4),force_dealer_id:id(5),idempotency_key:id(6)};
async function request(body,options={}){
 let handler;const calls=[];
 const receipt=Object.hasOwn(options,'receipt')?options.receipt:{outcome:'ok',assignment_id:id(7)};
 runInNewContext(options.sourceOverride??source,{Request,Response,console:{log(){},warn(){},error(){}},corsHeaders:{},
  authenticateUser:async()=>options.authResponse??{uid:options.actor??id(1)},manualDealerIntentHeaders:uid=>({'x-vinpoker-dealer-intent':'manual','x-vinpoker-dealer-actor':uid}),
  Deno:{env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[key]},serve:fn=>{handler=fn;}},
  createClient:()=>({
   from:name=>{calls.push({from:name});assert.equal(name,'game_tables','receipt must not reach assignment/attendance paths');const query={select(){return query;},eq(){return query;},maybeSingle:async()=>({data:Object.hasOwn(options,'table')?options.table:{id:id(3),club_id:id(2)},error:options.tableError??null})};return query;},
   rpc:async(name,args)=>{calls.push({name,args});if(options.throwRpc===name)throw new Error('synthetic transport failure');
    if(name==='is_club_dealer_control')return {data:Object.hasOwn(options,'control')?options.control:true,error:options.controlError??null};
    if(name==='worker_read_initial_assignment_receipt_v1')return {data:receipt,error:options.receiptError??null};
    if(name==='resolve_dealer_initial_assignment_intent_v1')return {data:Object.hasOwn(options,'resolved')?options.resolved:{status:'receipt_found',receipt},error:options.resolveError??null};
    assert.fail('unexpected writer/notification RPC '+name);},
  }),
 });
 const wire=(body?.mode==='receipt'||body?.mode==='resolve')&&!options.rawWire
  ?{mode:body.mode,assignment_intent:Object.fromEntries(Object.entries(body).filter(([key])=>key!=='mode'))}:body;
 const response=await handler(new Request('https://synthetic.invalid/functions/v1/assign-dealer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(wire)}));
 return {status:response.status,payload:await response.json(),calls:JSON.parse(JSON.stringify(calls))};
}
const failures=[];
async function check(name,test){try{await test();}catch(e){failures.push(name+': '+e.message);}}
await check('receipt route',async()=>{
 const read=await request(intent);assert.equal(read.status,200);assert.equal(read.payload.status,'receipt_found');
 assert.deepEqual(read.payload.assignment,{id:id(7),status:'success'});
 assert.equal(read.calls.filter(c=>c.from).length,0,'historical receipt does not require active table/assignment');
});
await check('expected actor binding',async()=>{
 const mismatch=await request({...intent,requested_by:id(1)},{actor:id(99)});assert.equal(mismatch.status,403);assert.equal(mismatch.calls.length,0);
});
await check('table read outage',async()=>{
 const tableFailure=await request({...intent,mode:'assign',requested_by:id(1)},{tableError:{message:'unavailable'}});assert.equal(tableFailure.status,503);
});
await check('receipt metadata and whitelist',async()=>{
 const answer=await request(intent,{receipt:{outcome:'ok',assignment_id:id(7),private_debug:'must not escape'}});
 assert.deepEqual(answer.payload,{...intent,status:'receipt_found',assignment:{id:id(7),status:'success'}});
 assert.deepEqual(answer.calls,[{name:'is_club_dealer_control',args:{_user_id:id(1),_club_id:id(2)}},
  {name:'worker_read_initial_assignment_receipt_v1',args:{p_request_key:`open_manual_${id(1)}_${id(6)}`,p_club_id:id(2),p_table_id:id(3),p_table_session_id:id(4),p_dealer_id:id(5)}}]);
});
await check('missing remains unknown read only',async()=>{
 const answer=await request(intent,{receipt:null});assert.equal(answer.status,200);assert.equal(answer.payload.status,'receipt_not_found');assert.equal(answer.payload.assignment,null);
 assert.equal(answer.calls.length,2);assert.equal(answer.calls.filter(c=>c.from).length,0);
});
await check('input and actor guards before database calls',async()=>{
 for(const patch of [{mode:'bad'},{mode:{}},{expected_actor_id:id(99)},{expected_actor_id:undefined},{expected_club_id:'bad'},
  {table_session_id:null},{force_dealer_id:null},{idempotency_key:'bad'},{return_suggestions_only:true}]){
  const answer=await request({...intent,...patch});assert.ok([400,403].includes(answer.status));assert.equal(answer.calls.length,0);
 }
});
await check('authority false versus unavailable',async()=>{
 const forbidden=await request(intent,{control:false});assert.equal(forbidden.status,403);assert.equal(forbidden.calls.length,1);
 for(const control of [null,{},[],1,'true']){
  const answer=await request(intent,{control});assert.equal(answer.status,503);assert.equal(answer.calls.length,1);
 }
 for(const options of [{controlError:{message:'outage'}},{throwRpc:'is_club_dealer_control'}]){
  const answer=await request(intent,options);assert.equal(answer.status,503);assert.equal(answer.calls.length,1);
 }
});
await check('malformed receipt is not missing or a commit',async()=>{
 for(const receipt of [{},false,0,'',[],{outcome:'ok',assignment_id:'bad'},{outcome:'ok',assignment_id:null}]){
  const answer=await request(intent,{receipt});assert.equal(answer.status,502);assert.equal(answer.calls.length,2);
 }
 const conflict=await request(intent,{receipt:{outcome:'idempotency_mismatch'}});assert.equal(conflict.status,409);
 for(const options of [{receiptError:{message:'unavailable'}},{throwRpc:'worker_read_initial_assignment_receipt_v1'}]){
  const answer=await request(intent,options);assert.equal(answer.status,503);assert.equal(answer.calls.length,2);
 }
});
await check('Auth status passthrough without privileged RPC',async()=>{
 for(const status of [401,503]){
  const answer=await request(intent,{authResponse:new Response(JSON.stringify({error:'synthetic auth'}),{status})});
  assert.equal(answer.status,status);assert.equal(answer.calls.length,0);
 }
});
await check('legacy stored receipt response remains compatible',async()=>{
 const legacy={...intent,mode:undefined,expected_actor_id:undefined,expected_club_id:undefined,requested_by:id(1)};
 const answer=await request(legacy);assert.equal(answer.status,200);assert.equal(answer.payload.status,'success');assert.equal(answer.payload.idempotent_replay,true);
 const club=await request({...legacy,expected_club_id:id(22)});assert.equal(club.status,403);assert.equal(club.payload.error,'ASSIGNMENT_CLUB_MISMATCH');
 const missing=await request(legacy,{table:null});assert.equal(missing.status,404);
});
await check('serialized obsolete proof route and exact args',async()=>{
 const value={...intent,mode:'resolve'};
 for(const status of ['intent_obsolete','receipt_not_found','legacy_receipt_review_required']){
  const answer=await request(value,{resolved:{status,receipt:null,private_debug:'must not escape'}});
  assert.equal(answer.status,200);assert.deepEqual(answer.payload,{...value,status,assignment:null});
  assert.deepEqual(answer.calls,[{name:'is_club_dealer_control',args:{_user_id:id(1),_club_id:id(2)}},
   {name:'resolve_dealer_initial_assignment_intent_v1',args:{p_actor_user_id:id(1),p_club_id:id(2),p_table_id:id(3),p_table_session_id:id(4),p_dealer_id:id(5),p_request_id:id(6)}}]);
 }
 const found=await request(value);assert.equal(found.status,200);assert.equal(found.payload.status,'receipt_found');assert.deepEqual(found.payload.assignment,{id:id(7),status:'success'});
 const actor=await request(value,{actor:id(99)});assert.equal(actor.status,403);assert.equal(actor.calls.length,0);
});
await check('flat read packets fail closed before database access',async()=>{
 for(const mode of ['receipt','resolve']){
  const answer=await request({...intent,mode},{rawWire:true});assert.equal(answer.status,400);assert.equal(answer.calls.length,0);
 }
});
await check('resolver malformed and unavailable remain nonterminal',async()=>{
 const value={...intent,mode:'resolve'};
 for(const resolved of [null,{},false,{status:'intent_obsolete'},{status:'intent_obsolete',receipt:{}},{status:'receipt_found',receipt:null},
  {status:'receipt_found',receipt:{outcome:'ok',assignment_id:'bad'}},{status:'made_up',receipt:null}]){
  const answer=await request(value,{resolved});assert.equal(answer.status,502);assert.equal(answer.calls.length,2);
 }
 for(const options of [{resolveError:{code:'55P03',message:'lock timeout'}},{resolveError:{code:'22023',message:'INITIAL_ASSIGNMENT_CONTEXT_MISMATCH'}},{throwRpc:'resolve_dealer_initial_assignment_intent_v1'}]){
  const answer=await request(value,options);assert.equal(answer.status,503);assert.equal(answer.calls.length,2);
 }
 assert.equal((await request(value,{resolveError:{code:'42501',message:'SWING_OPERATOR_FORBIDDEN'}})).status,403);
 assert.equal((await request(value,{resolveError:{code:'22023',message:'INITIAL_ASSIGNMENT_IDEMPOTENCY_CONFLICT'}})).status,409);
});
assert.deepEqual(failures,[]);
console.log('ASSIGN_DEALER_ACTUAL_HANDLER_READONLY_RECEIPT_ACTOR_SCOPE_OUTAGE_MATRIX_PASS');
// Optional historical-source proof, local full-history checkout only. CI's
// shallow checkout is not misreported as having exercised this comparison.
if(process.argv.includes('--legacy-wire')){
 const legacy=compile(execFileSync('git',['show','e140ae0d314a70186c4003bac245c11f5375eaa2:VinPoker/supabase/functions/assign-dealer/index.ts'],{encoding:'utf8'}));
 for(const mode of ['receipt','resolve']){
  const flat=await request({...intent,mode},{sourceOverride:legacy,rawWire:true});assert.equal(flat.status,200);assert.equal(flat.payload.status,'success','legacy ignored read mode and used assignment path');
  const nested=await request({...intent,mode},{sourceOverride:legacy});assert.equal(nested.status,400);assert.equal(nested.calls.length,0,'nested packet stops legacy before database paths');
 }
 console.log('ASSIGN_DEALER_PINNED_LEGACY_FLAT_ROUTE_REPRO_NESTED_FAIL_CLOSED_PASS');
}

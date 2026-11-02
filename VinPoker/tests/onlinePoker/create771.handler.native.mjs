import assert from 'node:assert/strict';
import {it} from 'node:test';
import {loadCreateAction} from './createAction.fixture.mjs';
const key='8bebc4cd-2246-4835-b006-d62d191618bb';
const actor='63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43';
const create={op:'create_open_table',name:'TEST',sb:'25',bb:'50',buyin:'5000',maxSeats:9,requestId:key,expectedActorId:actor};
async function run(body,{enabled=true,authorized=true,fault=false}={}){
 const logs=[],calls=[],gateCalls=[];
 const rpc=async(name,args)=>{calls.push([name,args]);return fault?{data:null,error:{message:'SYNTHETIC_PRIVATE_DB_DETAIL'}}:
  {data:name==='op_get_create_receipt_v1'?{outcome:'found',request_id:key,receipt:{outcome:'ok',request_id:key}}:{outcome:'ok',table_id:'TEST_TABLE',request_id:key},error:null};};
 const gate=async(...args)=>{gateCalls.push(args);return {data:enabled,error:null};};
 const user={auth:{getUser:async()=>({data:authorized?{user:{id:actor}}:null,error:authorized?null:{message:'denied'}})},rpc};
 const admin={rpc:gate};
 const handler=loadCreateAction((_url,apiKey)=>apiKey==='ANON_TEST'?user:admin,logs);
 const response=await handler(new Request('http://local.invalid/action',{method:'POST',headers:{authorization:'Bearer LOCAL_TEST_ONLY','content-type':'application/json'},body:JSON.stringify(body)}));
 return {status:response.status,body:await response.json(),calls,gateCalls,logs};
}
it('rejects an unkeyed create before any write RPC',async()=>{
 const {requestId:_key,...without}=create;void _key;const r=await run(without);
 assert.equal(r.status,400);assert.equal(r.calls.length,0);
});
it('uses only the keyed USER RPC and cannot accept a body actor override',async()=>{
 const r=await run({...create,actorId:'FORGED_TEST_ACTOR'});assert.equal(r.status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(r.calls)),[['op_create_open_table_v2',{p_name:'TEST',p_sb:'25',p_bb:'50',p_buyin:'5000',p_max_seats:9,p_request_id:key}]]);
});
it('reads an existing create receipt while gameplay is disabled without invoking a writer',async()=>{
 const r=await run({op:'get_create_receipt',requestId:key,expectedActorId:actor},{enabled:false});assert.equal(r.status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(r.calls)),[['op_get_create_receipt_v1',{p_request_id:key}]]);assert.equal(r.gateCalls.length,0);
});
it('still refuses new creates while disabled',async()=>{
 const r=await run(create,{enabled:false});assert.equal(r.status,403);assert.equal(r.calls.length,0);
});
it('rejects an unauthenticated caller before receipt lookup',async()=>{
 const r=await run({op:'get_create_receipt',requestId:key,expectedActorId:actor},{authorized:false});assert.equal(r.status,401);assert.equal(r.calls.length,0);
});
it('does not expose private RPC error details in a response or log',async()=>{
 const r=await run(create,{fault:true});assert.equal(r.status,400);assert.ok(!JSON.stringify([r.body,r.logs]).includes('SYNTHETIC_PRIVATE_DB_DETAIL'));
});
for(const requestId of [null,'','not-a-uuid'])it(`rejects malformed create/read request identity ${JSON.stringify(requestId)}`,async()=>{
 for(const body of [{...create,requestId},{op:'get_create_receipt',requestId,expectedActorId:actor}]){
  const r=await run(body);assert.equal(r.status,400);assert.equal(r.calls.length,0);
 }
});
it('rejects a journal actor different from the current JWT user before read or create',async()=>{
 const expectedActorId='181a034d-c701-4e76-91d6-2a05e28ec6e1';
 for(const body of [{...create,expectedActorId},{op:'get_create_receipt',requestId:key,expectedActorId}]){
  const r=await run(body);assert.equal(r.status,403);assert.equal(r.body.error,'actor_context_changed');assert.equal(r.calls.length,0);
 }
});
for(const expectedActorId of [undefined,null,'','not-a-uuid'])it(`requires a valid expected actor ${JSON.stringify(expectedActorId)}`,async()=>{
 for(const body of [{...create,expectedActorId},{op:'get_create_receipt',requestId:key,expectedActorId}]){
  const r=await run(body);assert.equal(r.status,400);assert.equal(r.calls.length,0);assert.equal(r.gateCalls.length,0);
 }
});

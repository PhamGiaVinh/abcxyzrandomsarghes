import test from 'node:test';import assert from 'node:assert/strict';
import {createOperationalHudControl} from './operations-hud-control.mjs';
const sha='a'.repeat(40),nonce='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',id2='33333333-3333-4333-8333-333333333333';
const request=(action='withdraw',requestId=id)=>({sha,nonce,requestId,action});
function fixture(){let text,applied=[],receipts=[];return {set(value){text=typeof value==='string'?value:JSON.stringify(value);},applied,receipts,control:createOperationalHudControl({sha,nonce,read:async()=>text,apply:async action=>{applied.push(action);return {sourceWrittenAt:1000};},write:async receipt=>receipts.push(receipt)})};}
test('one serialized withdrawal and restoration,exact replay never applies twice',async()=>{
 const f=fixture();await f.control.poll();f.set(request());await Promise.all([f.control.poll(),f.control.poll()]);await f.control.poll();
 assert.deepEqual(f.applied,['withdraw']);f.set(request('restore',id2));await f.control.poll();await f.control.stop();assert.deepEqual(f.applied,['withdraw','restore']);assert.equal(f.control.report().complete,true);
 await f.control.poll();assert.equal(f.applied.length,2);
});
test('foreign binding,extra keys,invalid UUID and oversized commands fail before mutation',async()=>{
 for(const value of [{...request(),sha:'b'.repeat(40)},{...request(),nonce:id2},{...request(),sql:'unsafe'},{...request(),requestId:'invalid'},'x'.repeat(1025),'null','[]']){
  const f=fixture();f.set(value);await assert.rejects(f.control.poll());assert.equal(f.applied.length,0);
 }
});
test('wrong order and conflicting same-id replay do not mutate',async()=>{
 const f=fixture();f.set(request('restore'));await assert.rejects(f.control.poll());f.set(request());await f.control.poll();f.set(request('restore'));await assert.rejects(f.control.poll(),/replay conflict/);assert.deepEqual(f.applied,['withdraw']);
});
test('failed apply is fatal evidence and cannot count as completed',async()=>{
 const control=createOperationalHudControl({sha,nonce,read:async()=>JSON.stringify(request()),apply:async()=>{throw Error('fixture failure');},write:async()=>{throw Error('unreachable');}});
 await assert.rejects(control.poll(),/fixture failure/);assert.deepEqual(control.report(),{uniqueApplied:0,withdrawn:false,complete:false});await assert.rejects(control.stop());
});

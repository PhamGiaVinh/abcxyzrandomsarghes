// Private disposable-fixture control, never an HTTP/product authorization API.
import assert from 'node:assert/strict';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function createOperationalHudControl({sha,nonce,read,apply,write}){
 assert.match(sha,/^[a-f0-9]{40}$/);assert.match(nonce,uuid);
 const seen=new Map();let next='withdraw',stopping=false,flight=null;
 async function process(){
  const text=await read();if(text===undefined)return;
  assert.ok(typeof text==='string'&&Buffer.byteLength(text)<=1024,'Bounded control request required');
  const request=JSON.parse(text);
  assert.ok(request&&typeof request==='object'&&!Array.isArray(request));
  assert.deepEqual(Object.keys(request).sort(),['action','nonce','requestId','sha']);
  assert.equal(request.sha,sha);assert.equal(request.nonce,nonce);assert.match(request.requestId,uuid);
  assert.ok(['withdraw','restore'].includes(request.action));
  const prior=seen.get(request.requestId);
  if(prior){assert.equal(prior.action,request.action,'Control request replay conflict');await write(prior);return;}
  assert.equal(request.action,next,'Control actions must be withdraw then restore');
  const value=await apply(request.action);
  assert.ok(Number.isFinite(value.sourceWrittenAt)&&value.sourceWrittenAt>0);
  const receipt={...request,sourceWrittenAt:value.sourceWrittenAt,applied:true};
  seen.set(request.requestId,receipt);next=request.action==='withdraw'?'restore':'complete';
  await write(receipt);
 }
 return {
  poll(){if(stopping)return Promise.resolve();if(flight)return flight;flight=process().finally(()=>{flight=null;});return flight;},
  async stop(){stopping=true;await flight;assert.equal(next,'complete','Both fixture transitions must complete');},
  report(){return {uniqueApplied:seen.size,withdrawn:next==='restore',complete:next==='complete'};},
 };
}

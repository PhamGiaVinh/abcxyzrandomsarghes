import assert from 'node:assert/strict';
import {createFunding560Browser} from './funding560.browser.local.mjs';

// Isolated rollback transaction. Actual handlers and PostgreSQL; modeled auth/email sink.
// Does not use the running gateway or claim browser acceptance.
assert.equal(process.env.VINPOKER_FUNDING560_BROWSER,'1');
const log=[];
const bridge=await createFunding560Browser({actor:'675fe35e-60a8-4452-bb90-e79486d54da6',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',log});
const call=name=>bridge.route(new URL(`http://local.invalid/functions/v1/${name}`),'POST',{purchase_id:bridge.manifest.purchase});
try{
 const before=await call('admin-staking-funding-status');
 assert.equal(before.status,200);
 assert.deepEqual(before.value,{success:false,purchase_id:bridge.manifest.purchase,state:'not_recorded'}); // Observation only, not safe-to-retry proof.
 assert.equal(log.at(-1).funding560.sends,0);
 const funded=await call('admin-confirm-funded');
 assert.equal(funded.status,200);assert.equal(funded.value.success,true);
 assert.equal(funded.value.purchase_id,bridge.manifest.purchase);
 assert.equal(funded.value.delivery.state,'needs_attention');
 // Confirm includes a transient drain execution summary; read intentionally never runs that drain.
 const {effects,...receiptAndDelivery}=funded.value;
 assert.equal(effects.delivered,1);assert.equal(effects.needs_attention,1);
 for(let i=0;i<3;i++){
  const read=await call('admin-staking-funding-status');
  assert.equal(read.status,200);assert.deepEqual(read.value,receiptAndDelivery);
  assert.equal(log.at(-1).funding560.sends,2);
 }
 assert.equal(log.filter(x=>x.funding560.operation==='confirm').length,1);
 assert.equal(log.filter(x=>x.funding560.operation==='read').length,4);
 console.log('FUNDING562_ACTUAL_HANDLERS_NATIVE_READ_REPEAT_NO_RESEND_PASS');
}finally{await bridge.cleanup();}

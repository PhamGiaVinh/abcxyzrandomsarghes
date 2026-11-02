import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createSePay608Browser} from './sepay608.browser.local.mjs';
import {parseSePayReceipt,sepayIntentArgs} from '../../src/lib/sepaySettlementIntent.ts';
assert.equal(process.env.VINPOKER_SEPAY608_QUALIFY,'1');
assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');assert.equal(process.env.VINPOKER_SEPAY608_BROWSER,'1');
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',log=[];
let bridge;
try{
 bridge=await createSePay608Browser({sql,actor,log});
 const f=bridge.manifest,url=name=>new URL(`http://127.0.0.1/rest/v1/rpc/${name}`);
 const worklist=await bridge.route(url('sepay_cashier_settlement_worklist'),'POST',{p_limit:200,p_scope:'actionable'});
 assert.equal(worklist.status,200);assert.equal(worklist.value.length,2);
 assert.ok(worklist.value.every(row=>row.registration_id===f.registration&&row.club_id===f.club&&row.reg_match_count===1&&row.reg_total_pay===100000));
 const first={actorId:actor,clubId:f.club,bankId:f.banks[0].id,registrationId:f.registration,operation:'confirm',reason:'TEST608 first partial',requestId:randomUUID(),snapshot:{bank_amount:40000,total_pay:100000}};
 const lost=await bridge.route(url('cashier_sepay_intent_v1'),'POST',sepayIntentArgs(first,'commit'));assert.equal(lost.status,503);
 const recovered=await bridge.route(url('cashier_sepay_intent_v1'),'POST',sepayIntentArgs(first,'receipt'));
 assert.deepEqual(parseSePayReceipt(recovered.value,first),{status:'partial',received:40000,remaining:60000,surplus:0});
 const replay=await bridge.route(url('cashier_sepay_intent_v1'),'POST',sepayIntentArgs(first,'receipt'));assert.deepEqual(replay.value,recovered.value);
 const second={...first,bankId:f.banks[1].id,reason:'TEST608 completion',requestId:randomUUID(),snapshot:{bank_amount:80000,total_pay:100000}};
 const completed=await bridge.route(url('cashier_sepay_intent_v1'),'POST',sepayIntentArgs(second,'commit'));
 assert.equal(completed.status,200);assert.deepEqual(parseSePayReceipt(completed.value,second),{status:'waiting',surplus:20000});
 assert.deepEqual(await bridge.facts(),{cash:2,received:120000,applied:100000,entries:0,seats:0,receipts:0,paid:true});
 console.log('SEPAY608_NATIVE_WORKLIST_PARTIAL_LOSS_READ_REPLAY_SURPLUS_WAIT_PRODUCT_PARSER_PASS',JSON.stringify(log));
}finally{await bridge?.cleanup();}

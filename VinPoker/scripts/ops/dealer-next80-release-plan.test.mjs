import test from 'node:test';import assert from 'node:assert/strict';
import {atomicSql,preflightSql,postcheckSql,executePackage} from './dealer-next80-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('next80 has one transaction, exact dependencies and objects before receipt',()=>{
 const sql=atomicSql();assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 for(const version of ['20270128000078','20270128000079','20270128000081'])assert.ok(preflightSql().includes(version));
 for(const digest of ['e0be4b77eb58641cfaf42f0d6e17ddb8','9f78e155af0a22cbf256f71991f6d3e5']){
  assert.ok(sql.indexOf(digest)<sql.indexOf("VALUES('20270128000080'"));assert.ok(postcheckSql().includes(digest));
 }
});
for(const proof of [{count:0,exact:false},{count:1,exact:true},{count:1,exact:false},null]){
 test(`unknown next80 outcome ${JSON.stringify(proof)} stops after one receipt read`,()=>{
  let writes=0,reads=0;const reports=[];
  assert.throws(()=>executePackage({json:sql=>{
   if(sql.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};
   reads++;if(proof===null)throw Error('unavailable');return proof;
  },execute:()=>{writes++;throw Error('lost response');}},s=>reports.push(s)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,1);assert.match(reports[0],/no retry or downstream/);
 });
}
test('wrong receipt or failed object postcheck cannot report success',()=>{
 for(const exact of [false,true]){let writes=0;const reports=[];
  assert.throws(()=>executePackage({json:sql=>sql.includes("'database'")?
   {database:'postgres',actor:'postgres',existing:0}:{count:1,exact},execute:()=>{
    if(++writes===2)throw Error('object drift');}},s=>reports.push(s)),/postcheck requires review/);
  assert.equal(writes,exact?2:1);assert.match(reports[0],/postcheck-unverified/);
 }
});
test('wrong actor baseline does not issue apply',()=>{
 let writes=0;assert.throws(()=>executePackage({json:()=>({database:'postgres',actor:'authenticated',existing:0}),
 execute:()=>writes++}),/baseline/);assert.equal(writes,0);
});

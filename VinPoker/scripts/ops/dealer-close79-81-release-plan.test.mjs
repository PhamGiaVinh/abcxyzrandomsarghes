import test from 'node:test';import assert from 'node:assert/strict';
import {atomicSql,postcheckSql,executePackage} from './dealer-close79-81-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('79+81 have one transaction and final full object before last receipt',()=>{
 const sql=atomicSql();assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.indexOf('cda0bd0e9eb9ee15fe3cdf5c36fcc238')<sql.indexOf("VALUES('20270128000081'"));
 assert.ok(postcheckSql().includes("'20270128000079','20270128000081'"));
});
for(const [status,result] of [['not-recorded',{count:0,exact:false}],['committed-exact',{count:2,exact:true}],['drift',{count:1,exact:false}],['drift',{count:2,exact:false}],['unavailable',null]]){
 test(`unknown combined outcome ${JSON.stringify(result)} stops without retry`,()=>{
  let writes=0,reads=0;const reports=[];
  assert.throws(()=>executePackage({json:sql=>{
   if(sql.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};
   reads++;if(result===null)throw Error('unavailable');return result;
  },execute:()=>{writes++;throw Error('lost response');}},s=>reports.push(s)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,1);assert.deepEqual(reports,[`STOP close79+81 ${status}; no retry or downstream deploy`]);
 });
}
test('acknowledged combined commit with wrong receipt makes no postcheck mutation',()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:sql=>sql.includes("'database'")?{database:'postgres',actor:'postgres',existing:0}:{count:1,exact:false},execute:()=>writes++},s=>reports.push(s)),/requires review/);
 assert.equal(writes,1);assert.deepEqual(reports,['STOP close79+81 commit-acknowledged/postcheck-unverified; no retry or downstream deploy']);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,postcheckSql,executePackage} from './dealer-close79-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('close79 checks complete function before recording exact SQL atomically',()=>{
 const item=loadMigration(),sql=atomicSql();assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.indexOf('70b3e4bb3bc85973152e8ed21fae4438')<sql.indexOf(`VALUES('${item.version}'`));
 assert.ok(preflightSql().startsWith('BEGIN READ ONLY;'));assert.ok(postcheckSql().startsWith('BEGIN READ ONLY;'));
 assert.ok(postcheckSql().includes('p.proacl::text'));assert.ok(postcheckSql().includes('p.proconfig'));
});
for(const [status,result] of [['not-recorded',{count:0,exact:false}],['committed-exact',{count:1,exact:true}],['drift',{count:1,exact:false}],['unavailable',null]]){
 test(`close79 lost response observes ${status} once, never retries`,()=>{
  let writes=0,reads=0;const lines=[];
  assert.throws(()=>executePackage({json:sql=>{
   if(sql.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};
   reads++;if(result===null)throw Error('unavailable');return result;
  },execute:()=>{writes++;throw Error('lost response');}},line=>lines.push(line)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,1);
  assert.deepEqual(lines,[`STOP 20270128000079 ${status}; no retry or downstream deploy`]);
 });
}
test('close79 invalid baseline writes nothing',()=>{
 let writes=0;assert.throws(()=>executePackage({json:()=>({database:'wrong',actor:'postgres',existing:0}),execute:()=>writes++}),/baseline/);assert.equal(writes,0);
});
for(const stage of ['receipt','object'])test(`close79 acknowledged commit with failed ${stage} check stops`,()=>{
 let executions=0,reads=0;const lines=[];
 assert.throws(()=>executePackage({json:sql=>{
  if(sql.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};
  reads++;if(stage==='receipt')throw Error('unavailable');return {count:1,exact:true};
 },execute:()=>{executions++;if(executions===2)throw Error('postcheck failed');}},line=>lines.push(line)),/postcheck review/);
 assert.equal(executions,stage==='receipt'?1:2);assert.equal(reads,1);
 assert.deepEqual(lines,['STOP 20270128000079 commit-acknowledged/postcheck-unverified; no retry or downstream deploy']);
});

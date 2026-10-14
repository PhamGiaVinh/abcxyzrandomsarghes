import test from 'node:test';import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,postcheckSql,executePackage} from './dealer-rest78-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('rest78 records exact migration only after full object postcheck in one transaction',()=>{
 const item=loadMigration(),sql=atomicSql();assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.includes('pg_advisory_xact_lock(280000,3747)'));
 assert.ok(sql.indexOf("54fe092e15f6b90b54a51d130fec32c9")<sql.indexOf(`VALUES('${item.version}'`));
 assert.ok(sql.includes(item.sql.slice(scanMigrationSource(item.sql).insertAfterBegin,scanMigrationSource(item.sql).insertBeforeCommit)));
 assert.ok(preflightSql().startsWith('BEGIN READ ONLY;'));assert.ok(postcheckSql().startsWith('BEGIN READ ONLY;'));
 assert.ok(postcheckSql().includes('p.proacl::text'));assert.ok(postcheckSql().includes('p.proconfig'));
});
test('unknown commit result observes one receipt but never retries',()=>{
 let writes=0,reads=0;
 assert.throws(()=>executePackage({json:sql=>sql.includes("'database'")?{database:'postgres',actor:'postgres',existing:0}:(reads++,{count:0,exact:false}),execute:()=>{writes++;throw Error('response lost');}}),/requires review/);
 assert.equal(writes,1);assert.equal(reads,1);
});
test('invalid preflight makes no mutation',()=>{
 let writes=0;assert.throws(()=>executePackage({json:()=>({database:'wrong',actor:'postgres',existing:0}),execute:()=>writes++}),/baseline/);assert.equal(writes,0);
});

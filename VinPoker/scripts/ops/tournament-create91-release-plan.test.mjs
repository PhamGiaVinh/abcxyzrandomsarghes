import test from 'node:test';import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,postcheckSql,executePackage} from './tournament-create91-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('91 exact source and function ACL postcheck precede atomic ledger receipt',()=>{
 const item=loadMigration(),sql=atomicSql(),scan=scanMigrationSource(item.sql);
 assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.includes(item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)));
 assert.ok(sql.indexOf('create91_objects')<sql.indexOf(`VALUES('${item.version}'`));
 assert.ok(sql.includes('pg_advisory_xact_lock(280000,3747)'));
 assert.ok(preflightSql().startsWith('BEGIN READ ONLY;'));assert.ok(postcheckSql().startsWith('BEGIN READ ONLY;'));
 for(const name of ['create_tournament_with_levels_v1','get_tournament_create_receipt_v1','floor_table_v3_existing_receipt','floor_table_v3_lock_receipt','floor_table_v3_save_receipt','has_role','is_club_dealer_control'])assert.ok(sql.includes(name));
 assert.ok(postcheckSql().includes('p.proacl'));assert.ok(postcheckSql().includes('p.proconfig'));
});
for(const [status,result] of [['committed-exact',{count:1,exact:true}],['not-recorded',{count:0,exact:false}],['drift',{count:1,exact:false}],['unavailable',null]])test(`lost apply response ${status} observes once and never retries`,()=>{
 let writes=0,reads=0;const report=[];
 assert.throws(()=>executePackage({json:sql=>{if(sql.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};reads++;if(result===null)throw Error();return result;},execute:()=>{writes++;throw Error('lost response');}},x=>report.push(x)),/requires review/);
 assert.equal(writes,1);assert.equal(reads,1);assert.deepEqual(report,[`STOP 20270128000091 ${status}; no retry or downstream deploy`]);
});
test('invalid preflight never writes',()=>{let writes=0;assert.throws(()=>executePackage({json:()=>({database:'wrong',actor:'postgres',existing:0}),execute:()=>writes++}),/baseline/);assert.equal(writes,0);});
for(const stage of ['receipt','object'])test(`acknowledged commit ${stage} failure stops without replay`,()=>{
 let writes=0;const report=[];
 assert.throws(()=>executePackage({json:sql=>{if(sql.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};if(stage==='receipt')throw Error();return {count:1,exact:true};},execute:()=>{writes++;if(writes===2)throw Error();}},x=>report.push(x)),/postcheck review/);
 assert.equal(writes,stage==='receipt'?1:2);assert.deepEqual(report,['STOP 20270128000091 commit-acknowledged/postcheck-unverified; no retry or downstream deploy']);
});

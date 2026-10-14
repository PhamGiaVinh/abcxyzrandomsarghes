import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,postcheckSql,classifyPreflight,executePackage} from './tracker-manual-75-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('manual75 pins exact source, prior74 objects/receipt and atomic75 ledger',()=>{
 const item=loadMigration(),sql=atomicSql();assert.equal(item.version,'20270128000075');
 assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.includes('pg_advisory_xact_lock(280000,3747)'));
 assert.ok(sql.includes('manual75_previous_ledger_drift'));assert.ok(sql.includes('visibility74_helper_acl_postcheck'));
 assert.ok(sql.indexOf('manual75_previous_ledger_drift')<sql.indexOf('CREATE TABLE floor_private.tracker_manual_card_receipts_v1'));
 assert.ok(sql.indexOf('manual75_receipt_table_postcheck')<sql.lastIndexOf('INSERT INTO supabase_migrations.schema_migrations'));
 assert.ok(preflightSql().startsWith('BEGIN READ ONLY;'));assert.ok(!preflightSql().includes('CREATE TABLE'));
 assert.ok(postcheckSql().startsWith('BEGIN READ ONLY;'));assert.ok(postcheckSql().includes('manual75_function_postcheck'));
});
test('manual75 rejects wrong actor/database/existing ledger before writes',()=>{
 const good={database:'postgres',actor:'postgres',existing:0};classifyPreflight(good);
 for(const r of [{...good,database:'other'},{...good,actor:'service_role'},{...good,existing:1},null])assert.throws(()=>classifyPreflight(r));
});
test('unknown manual75 apply outcome checks receipt once and never retries or runs postcheck',()=>{
 for(const observed of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false},null]){
  let writes=0,reads=0;const reports=[];
  assert.throws(()=>executePackage({json:q=>{if(q.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};reads++;if(!observed)throw Error('unavailable');return observed;},execute:()=>{writes++;throw Error('response lost');}},s=>reports.push(s)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,1);assert.match(reports[0],/no retry or downstream apply/);
 }
});
test('manual75 success requires exact receipt and readonly object/ACL postcheck',()=>{
 const writes=[],reports=[];executePackage({json:q=>q.includes("'database'")?{database:'postgres',actor:'postgres',existing:0}:{count:1,exact:true},execute:q=>writes.push(q)},s=>reports.push(s));
 assert.equal(writes.length,2);assert.ok(writes[1].startsWith('BEGIN READ ONLY;'));assert.equal(reports.at(-1),'MANUAL75_OBJECT_POSTCHECK_PASS');
});

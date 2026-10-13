import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,postcheckSql,classifyPreflight,executePackage} from './tracker-public-74-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('exact74 immutable source and one transaction with receipt after object guards',()=>{
 const i=loadMigration(),sql=atomicSql();assert.equal(i.version,'20270128000074');
 assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.indexOf('visibility74_policy_expression_postcheck')<sql.lastIndexOf('INSERT INTO supabase_migrations.schema_migrations'));
 assert.ok(sql.includes('pg_advisory_xact_lock(280000,3747)'));
 assert.ok(sql.includes('$visibility74_receipt$'));
 assert.ok(preflightSql().startsWith('BEGIN READ ONLY;'));
 assert.ok(postcheckSql().includes('visibility74_helper_acl_postcheck'));
});
test('preflight rejects wrong database actor and any existing receipt',()=>{
 const good={database:'postgres',actor:'postgres',existing:0};classifyPreflight(good);
 for(const bad of [{...good,database:'other'},{...good,actor:'service_role'},{...good,existing:1},null])assert.throws(()=>classifyPreflight(bad));
});
test('lost response observes receipt once and never retries or runs downstream',()=>{
 let writes=0,reads=0;const reports=[];
 assert.throws(()=>executePackage({json:q=>{if(q.includes("'database'"))return {database:'postgres',actor:'postgres',existing:0};reads++;return {count:1,exact:true};},execute:()=>{writes++;throw Error('response lost');}},x=>reports.push(x)),/requires review/);
 assert.equal(writes,1);assert.equal(reads,1);assert.ok(reports[0].includes('committed-exact'));
});
test('success requires exact receipt and readonly object postcheck',()=>{
 const writes=[];const reports=[];
 executePackage({json:q=>q.includes("'database'")?{database:'postgres',actor:'postgres',existing:0}:{count:1,exact:true},execute:q=>writes.push(q)},x=>reports.push(x));
 assert.equal(writes.length,2);assert.ok(writes[1].startsWith('BEGIN READ ONLY;'));assert.equal(reports.at(-1),'VISIBILITY74_OBJECT_POSTCHECK_PASS');
});

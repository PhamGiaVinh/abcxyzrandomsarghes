import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPackage,atomicSql,preflightSql,classifyPreflight,postcheckSql,executePackage} from './tracker-voice-70-71-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
const good={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('exact ordered Voice allowlist and receipt are atomic; no old migration replay',()=>{
 const items=loadPackage();assert.deepEqual(items.map(i=>i.version),['20270128000070','20270128000071']);
 for(const i of items){
  const sql=atomicSql(i);assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
  assert.ok(sql.indexOf('pg_advisory_xact_lock')<sql.indexOf('DO $migration$'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')>sql.indexOf('END;\n$migration$;'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
  for(const k of ['version','name','hash','filename','sql'])assert.throws(()=>atomicSql({...i,[k]:i[k]+'drift'}));
 }
 assert.match(atomicSql(items[1]),/version='20270128000070' AND name='tracker_voice_card_actor_epoch_fences_v1'/);
 assert.match(preflightSql(),/c92283d9084afe9dd68c1967e80366f3af9fe55cea1589b04f67239df8374b5f/);
 assert.match(postcheckSql(2),/16006fec6f3b9274581de471a9dc296a/);
 assert.throws(()=>postcheckSql(0));
});
test('preflight rejects wrong database, actor, existing partial package and object drift',()=>{
 classifyPreflight(good);
 for(const delta of [{database:'other'},{actor:'other'},{existing:1},{baseline:false}])assert.throws(()=>classifyPreflight({...good,...delta}));
});
test('lost response observes once and never retries or applies downstream',()=>{
 let writes=0,reads=0;const reports=[];
 assert.throws(()=>executePackage({json:()=>++reads===1?good:{count:1,exact:true},execute:()=>{writes++;throw Error('lost');}},x=>reports.push(x)),/requires review/);
 assert.equal(writes,1);assert.equal(reads,2);assert.deepEqual(reports,['STOP 20270128000070 receipt=committed-exact; no retry or downstream apply']);
});
test('second failure preserves exact first receipt; full success checks both objects',()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:()=>{if(++writes===3)throw Error('second failed');}},x=>reports.push(x)),/requires review/);
 assert.equal(writes,3);assert.match(reports[0],/^COMMITTED_EXACT 20270128000070 /);assert.match(reports[1],/^STOP 20270128000071 /);
 writes=0;executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:()=>writes++});assert.equal(writes,4);
});
test('receipt or object postcheck failure prevents downstream apply',()=>{
 let writes=0;
 assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:false},execute:()=>writes++}),/receipt postcheck/);assert.equal(writes,1);
 writes=0;assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:()=>{if(++writes===2)throw Error('object drift');}}),/object drift/);assert.equal(writes,2);
});

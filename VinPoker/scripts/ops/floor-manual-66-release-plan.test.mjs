import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,classifyPreflight,executePackage} from './floor-manual-66-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
const good={database:'postgres',actor:'postgres',existing:0,namespace_absent:true};
test('exact66 pins the reviewed SQL and records it with object checks before COMMIT',()=>{
  const i=loadMigration(),sql=atomicSql(); assert.equal(i.version,'20270128000066');
  assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
  assert.ok(sql.indexOf('manual66_object_postcheck_failed')<sql.indexOf('INSERT INTO supabase_migrations.schema_migrations'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
  for(const k of ['version','name','filename','hash','sql']) assert.throws(()=>atomicSql({...i,[k]:i[k]+'drift'}));
  assert.match(preflightSql(),/manual_player_dependency_drift/);
});
test('exact66 denies reused version, actor, target or namespace',()=>{
  assert.doesNotThrow(()=>classifyPreflight(good));
  for(const delta of [{database:'other'},{actor:'other'},{existing:1},{namespace_absent:false}]) assert.throws(()=>classifyPreflight({...good,...delta}));
});
test('lost response observes a receipt once, never retries',()=>{
  let writes=0,reads=0;const reports=[];
  assert.throws(()=>executePackage({json:()=>++reads===1?good:{count:1,exact:true},execute:()=>{writes++;throw Error('lost');}},v=>reports.push(v)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,2);assert.deepEqual(reports,['MANUAL66 receipt=committed-exact; no retry']);
});
test('successful transport still needs exact receipt and postcheck',()=>{
  let writes=0;executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:()=>writes++});assert.equal(writes,2);
  assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:false},execute:()=>{}}),/receipt postcheck/);
});

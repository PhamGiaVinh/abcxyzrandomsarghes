import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,classifyPreflight,executePackage} from './floor-manual-68-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
const good={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('exact68 pins the reviewed SQL and records it with object checks before COMMIT',()=>{
  const i=loadMigration(),sql=atomicSql(); assert.equal(i.version,'20270128000068');
  assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
  assert.ok(sql.indexOf('manual68_object_postcheck_failed')<sql.indexOf('INSERT INTO supabase_migrations.schema_migrations'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
  for(const k of ['version','name','filename','hash','sql']) assert.throws(()=>atomicSql({...i,[k]:i[k]+'drift'}));
  assert.match(preflightSql(),/floor_manual_seat_session_fence_v1/);
  for(const pin of ['2da4583e6d695ec2e36779f31dc4d784142e85e6e29888ab1ae633010490d90b',
    '427ec7f078b6e7c258af3dd165d2ce7400155acae144140a045472bc1c8d6597',
    '1fa4fcae06f56774b40913b83a6b239a']) assert.ok(preflightSql().includes(pin));
});
test('exact68 denies reused version, actor, target or namespace',()=>{
  assert.doesNotThrow(()=>classifyPreflight(good));
  for(const delta of [{database:'other'},{actor:'other'},{existing:1},{baseline:false}]) assert.throws(()=>classifyPreflight({...good,...delta}));
});
test('lost response observes a receipt once, never retries',()=>{
  let writes=0,reads=0;const reports=[];
  assert.throws(()=>executePackage({json:()=>++reads===1?good:{count:1,exact:true},execute:()=>{writes++;throw Error('lost');}},v=>reports.push(v)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,2);assert.deepEqual(reports,['MANUAL68 receipt=committed-exact; no retry']);
});
test('successful transport still needs exact receipt and postcheck',()=>{
  let writes=0;executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:()=>writes++});assert.equal(writes,2);
  assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:false},execute:()=>{}}),/receipt postcheck/);
});

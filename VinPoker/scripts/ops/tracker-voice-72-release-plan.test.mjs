import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,classifyPreflight,executePackage} from './tracker-voice-72-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
const good={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('72 immutable SQL, object checks and exact receipt share one transaction',()=>{
  const i=loadMigration(),sql=atomicSql();assert.equal(i.version,'20270128000072');
  assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
  assert.ok(sql.indexOf('voice_assignment72_definition_postcheck')<sql.indexOf('INSERT INTO supabase_migrations.schema_migrations'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
  for(const k of ['version','name','filename','hash','sql'])assert.throws(()=>atomicSql({...i,[k]:i[k]+'drift'}));
  assert.match(preflightSql(),/1a747f345d56b6ff4b5c13186dd5e98f9db384e918659808b638e39be6203993/);
});
test('72 rejects wrong target, existing ledger and baseline drift',()=>{
  classifyPreflight(good);
  for(const d of [{database:'other'},{actor:'other'},{existing:1},{baseline:false}])assert.throws(()=>classifyPreflight({...good,...d}));
});
test('unknown apply observes once and never retries',()=>{
  let writes=0,reads=0;const reports=[];
  assert.throws(()=>executePackage({json:()=>++reads===1?good:{count:1,exact:true},execute:()=>{writes++;throw Error('lost');}},x=>reports.push(x)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,2);assert.deepEqual(reports,['VOICE72 receipt=committed-exact; no retry']);
});
test('successful transport requires receipt and object proof',()=>{
  let writes=0;executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:()=>writes++});assert.equal(writes,2);
  assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:false},execute:()=>{}}),/receipt postcheck/);
});

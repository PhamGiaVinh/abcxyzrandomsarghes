import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,preflightSql,classifyPreflight,executePackage} from './floor-roster-62-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('exact62 pins SQL and inserts receipt before its only COMMIT',()=>{
 const item=loadMigration(),sql=atomicSql();
 assert.equal(item.version,'20270128000062');
 // The receipt contains SQL text, not a second executable COMMIT.
 assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
 for(const key of ['version','name','filename','hash','sql'])assert.throws(()=>atomicSql({...item,[key]:item[key]+'changed'}));
 assert.match(preflightSql(),/get_tournament_participation_v1/);
});
test('exact62 denies drift and existing receipt or RPC',()=>{
 const good={database:'postgres',actor:'postgres',existing:0,baseline:true,new_rpc_absent:true};
 assert.doesNotThrow(()=>classifyPreflight(good));
 for(const delta of [{database:'other'},{actor:'other'},{existing:1},{baseline:false},{new_rpc_absent:false}])assert.throws(()=>classifyPreflight({...good,...delta}));
});
test('unknown commit outcome reads receipt once and never retries apply',()=>{
 let writes=0,reads=0;const reports=[];
 assert.throws(()=>executePackage({json:()=>++reads===1?{database:'postgres',actor:'postgres',existing:0,baseline:true,new_rpc_absent:true}:{count:1,exact:true},execute:()=>{writes++;throw Error('lost response');}},x=>reports.push(x)),/requires review/);
 assert.equal(writes,1);assert.equal(reads,2);assert.deepEqual(reports,['STOP62 receipt=committed-exact; no retry']);
});
test('success requires both exact receipt and object postcheck',()=>{
 let writes=0;const reports=[];
 const json=q=>q.includes('current_database()')?{database:'postgres',actor:'postgres',existing:0,baseline:true,new_rpc_absent:true}:{count:1,exact:true};
 executePackage({json,execute:()=>writes++},x=>reports.push(x));
 assert.equal(writes,2);assert.equal(reports.at(-1),'ROSTER62_OBJECT_POSTCHECK_PASS');
 writes=0;
 assert.throws(()=>executePackage({json,execute:()=>{if(++writes===2)throw Error('postcheck failure');}}));
});

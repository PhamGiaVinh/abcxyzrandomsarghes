import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPackage,atomicSql,preflightSql,postcheckSql,classifyPreflight,executePackage} from './tracker-voice-72-73-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
const good={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('72/73 exact immutable sources share one outer transaction and both receipts',()=>{
 const items=loadPackage(),sql=atomicSql();assert.deepEqual(items.map(i=>i.version),['20270128000072','20270128000073']);
 assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
 assert.ok(sql.indexOf('voice73_definition_postcheck')<sql.lastIndexOf('INSERT INTO supabase_migrations.schema_migrations'));
 assert.ok(sql.lastIndexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
 assert.ok(sql.includes('$voice72_receipt$'));assert.ok(sql.includes('$voice73_receipt$'));
 for(const i of items)assert.ok(sql.includes(i.sql),'receipt embeds exact immutable source');
 assert.match(preflightSql(),/3f3e35df593064562056326969364bac/);
 assert.match(postcheckSql(),/a25a91e02d6f2c0399e5aba1086e4acf/);
});
test('72/73 rejects target, replay and baseline drift',()=>{
 classifyPreflight(good);
 for(const delta of [{database:'other'},{actor:'other'},{existing:1},{baseline:false}])assert.throws(()=>classifyPreflight({...good,...delta}));
});
test('lost response checks both receipts once and never retries the transaction',()=>{
 let reads=0,writes=0;const reports=[];
 assert.throws(()=>executePackage({json:()=>++reads===1?good:{count:1,exact:true},execute:()=>{writes++;throw Error('lost response');}},r=>reports.push(r)),/requires review/);
 assert.equal(writes,1);assert.equal(reads,3);assert.equal(reports.length,2);
 assert.ok(reports.every(r=>r.includes('receipt=committed-exact; no retry or downstream apply')));
});
test('success requires both exact receipts and final object proof',()=>{
 let writes=0;executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:()=>writes++});assert.equal(writes,2);
 for(const version of ['20270128000072','20270128000073']){
  assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:!q.includes(version)},execute:()=>{}}),/receipt postcheck/);
 }
 assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?good:{count:1,exact:true},execute:q=>{if(q.includes('voice73_object_postcheck_failed'))throw Error('postcheck unavailable');}}),/postcheck unavailable/);
});

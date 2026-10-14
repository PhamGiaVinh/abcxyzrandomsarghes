import test from 'node:test';import assert from 'node:assert/strict';
import {loadMigrations,atomicSql,preflightSql,postcheckSql,executePackage} from './tracker-reads-76-77-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('reads76/77 one transaction preserves75/74 dependencies and records exact SQL after postchecks',()=>{
 const sql=atomicSql();assert.equal(scanMigrationSource(sql).mode,'outer-transaction');assert.equal(loadMigrations().length,2);
 assert.ok(sql.includes('pg_advisory_xact_lock(280000,3747)'));assert.ok(sql.includes('reads_previous75_receipt_drift'));
 for(const item of loadMigrations())assert.ok(sql.includes(item.sql));
 assert.ok(sql.indexOf('context76_old_contract_or_private_schema_changed')<sql.indexOf("VALUES('20270128000076'"));
 assert.ok(sql.indexOf('roster77_old_contract_or_private_schema_changed')<sql.indexOf("VALUES('20270128000077'"));
 assert.ok(preflightSql().startsWith('BEGIN READ ONLY;'));assert.ok(!preflightSql().includes('CREATE FUNCTION'));
 assert.ok(postcheckSql().startsWith('BEGIN READ ONLY;'));
});
test('unknown response observes both receipts once, never retries or runs downstream',()=>{
 let writes=0,receipts=0;assert.throws(()=>executePackage({json:sql=>sql.includes("'database'")?{database:'postgres',actor:'postgres',existing:0}:(receipts++,{count:0,exact:false}),execute:()=>{writes++;throw Error('response lost');}}),/requires review/);
 assert.equal(writes,1);assert.equal(receipts,2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPackage,atomicSql,postcheckSql,executePackage } from './physical-asset-63-65-release-plan.mjs';
import { scanMigrationSource } from './ops-1359-release-gate.mjs';
test('only exact63 and forward65, one atomic transaction and both ledger receipts',()=>{
  assert.deepEqual(loadPackage().map(item=>item.version),['20270128000063','20270128000065']);
  const sql=atomicSql();
  assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
  assert.equal((sql.match(/INSERT INTO supabase_migrations.schema_migrations\(version,name,statements\)/g)||[]).length,2);
  assert.ok(sql.indexOf('CREATE FUNCTION public.declare_club_physical_table_v1') < sql.indexOf('CREATE OR REPLACE FUNCTION public.declare_club_physical_table_v1'));
  assert.match(sql,/pg_advisory_xact_lock\(280000,3747\)/);
  assert.match(sql,/asset_package_dependency_drift/);
});
test('exact object, ACL, overload and both receipt hashes are independently postchecked',()=>{
  const sql=postcheckSql();
  for(const item of loadPackage()) assert.ok(sql.includes(item.hash));
  assert.match(sql,/c4c0bab3f601386c8b4f44d849c255df/);
  assert.match(sql,/aclexplode/);
});
test('successful commit requires both postchecks',()=>{
  let executed=0;
  executePackage({execute(){executed++;},json(){return {receipts:true,object:true};}});
  assert.equal(executed,1);
  for(const result of [{receipts:false,object:true},{receipts:true,object:false}])
    assert.throws(()=>executePackage({execute(){},json(){return result;}}),/postcheck drift/);
});
test('unknown commit outcome is observed once and never reapplied',()=>{
  let executed=0,observed=0; const reports=[];
  assert.throws(()=>executePackage({execute(){executed++;throw Error('response lost');},json(){observed++;return {receipts:true,object:true};}},x=>reports.push(x)),/requires review/);
  assert.equal(executed,1);assert.equal(observed,1);
  assert.match(reports[0],/committed-exact; no retry/);
});

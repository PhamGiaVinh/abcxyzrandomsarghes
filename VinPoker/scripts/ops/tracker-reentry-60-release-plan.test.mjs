import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,classifyPreflight,executePackage} from './tracker-reentry-60-release-plan.mjs';
const baseline={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('exact60 rejects precondition and allowlist drift',()=>{
 classifyPreflight(baseline);
 for(const delta of [{database:'test'},{actor:'service_role'},{existing:1},{baseline:false},{baseline:null}])assert.throws(()=>classifyPreflight({...baseline,...delta}));
 for(const field of ['version','name','filename','hash','sql'])assert.throws(()=>atomicSql({...loadMigration(),[field]:'changed'}));
});
test('DDL and ledger share one transaction with exact Cashier dependency',()=>{
 const sql=atomicSql();assert.match(sql,/pg_advisory_xact_lock\(280000,3747\)/);
 assert.match(sql,/362ead3a68b64614fce7137363cb918c/);
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')>sql.indexOf('GRANT EXECUTE'));
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
});
for(const observed of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false},null])test(`unknown commit never retries ${JSON.stringify(observed)}`,()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:q=>{if(q.includes('current_database()'))return baseline;if(observed===null)throw Error('unavailable');return observed;},execute:()=>{writes++;throw Error('lost response');}},x=>reports.push(x)));
 assert.equal(writes,1);assert.match(reports[0],/no retry/);
});
test('PASS needs exact ledger and object postcheck',()=>{
 let writes=0;const reports=[];
 executePackage({json:q=>q.includes('current_database()')?baseline:{count:1,exact:true},execute:()=>writes++},x=>reports.push(x));
 assert.equal(writes,2);assert.equal(reports.at(-1),'REENTRY60_OBJECT_POSTCHECK_PASS');
 for(const failPostcheck of [false,true]){
  let n=0;const failed=[];
  assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?baseline:{count:1,exact:failPostcheck},execute:()=>{if(++n===2)throw Error('catalog drift');}},x=>failed.push(x)));
  assert.deepEqual(failed,[]);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMigration,atomicSql,classifyPreflight,executePackage} from './tracker-void-59-protected-apply.mjs';
const baseline={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('dispatch preserves owner, exact checks, fresh recovery and shared production gate',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/tracker-void-59-protected-apply.yml',import.meta.url),'utf8');
 for(const required of ["github.ref == 'refs/heads/main'",'APPLY_TRACKER_VOID_59_',
 'INITIAL_ACTOR','TRIGGERING_ACTOR','GITHUB_REPOSITORY_OWNER','.head.sha','.state',
 'runtime postgres-17-integrated release-runner-postgres-17 collision-guard reject-sensitive-vars-context',
 'floor-v3-recovery-backup.yml','floor-v3-restore-verification-',
 'RECOVERY_BASE_SHA','dealer-swing-production-critical','vinpoker-production-database-release',
 'tracker-void-59-protected-apply.mjs plan','tracker-void-59-protected-apply.mjs apply'])assert.ok(yaml.includes(required),required);
 assert.ok(!yaml.includes('tracker-history-58-protected-apply.mjs'));
});
test('exact59 rejects preflight and allowlist drift',()=>{
 classifyPreflight(baseline);
 for(const delta of [{database:'test'},{actor:'service_role'},{existing:1},{baseline:false},{baseline:null}])assert.throws(()=>classifyPreflight({...baseline,...delta}));
 for(const field of ['version','name','filename','hash','sql'])assert.throws(()=>atomicSql({...loadMigration(),[field]:'changed'}));
});
test('DDL and receipt share one transaction and shared release lock',()=>{
 const sql=atomicSql();
 assert.match(sql,/pg_advisory_xact_lock\(280000,3747\)/);
 assert.match(sql,/void59_precondition_drift/);
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')>sql.indexOf('EXECUTE replace(definition,marker,replacement);'));
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
});
for(const observed of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false},null])test(`unknown commit never retries ${JSON.stringify(observed)}`,()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:q=>{if(q.includes('current_database()'))return baseline;if(observed===null)throw Error('unavailable');return observed;},execute:()=>{writes++;throw Error('lost response');}},x=>reports.push(x)),/outcome requires review/);
 assert.equal(writes,1);assert.equal(reports.length,1);assert.match(reports[0],/no retry/);
});
test('PASS needs exact receipt and object postcheck',()=>{
 let writes=0;const reports=[];
 executePackage({json:q=>q.includes('current_database()')?baseline:{count:1,exact:true},execute:()=>writes++},x=>reports.push(x));
 assert.equal(writes,2);assert.equal(reports.at(-1),'VOID59_OBJECT_POSTCHECK_PASS');
});
test('wrong receipt or failed postcheck cannot emit PASS',()=>{
 for(const failPostcheck of [false,true]){
  let writes=0;const reports=[];
  assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?baseline:{count:1,exact:failPostcheck},execute:()=>{if(++writes===2)throw Error('object drift');}},x=>reports.push(x)));
  assert.equal(writes,failPostcheck?2:1);assert.deepEqual(reports,[]);
 }
});

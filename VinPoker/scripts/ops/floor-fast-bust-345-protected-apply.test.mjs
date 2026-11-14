import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadPackage,atomicSql,executeMigration,validateApproval,MANIFEST_SHA256} from './floor-fast-bust-345-protected-apply.mjs';
const sourceRoot=process.env.RELEASE_SOURCE_ROOT||mkdtempSync(join(tmpdir(),'floor345-release-source-'));
if(!process.env.RELEASE_SOURCE_ROOT){
 const path='supabase/migrations/20270128000345_floor_operator_fast_bust_v1.sql';
 mkdirSync(dirname(join(sourceRoot,path)),{recursive:true});
 writeFileSync(join(sourceRoot,path),execFileSync('git',['show','438290856c05fe426e41be0a385fd4431d4ffe16:VinPoker/'+path]));
}
const pkg=loadPackage(sourceRoot);
const ready={database:'postgres',actor:'postgres',existing:0,baseline:true,targetsAbsent:true};
test('only canonical SQL and reviewed atomic wrapper are eligible',()=>{
 assert.match(atomicSql(pkg),/floor345_source_or_target_drift_stop/);
 assert.throws(()=>atomicSql({...pkg,sql:pkg.sql+'\n-- changed'}));
 assert.throws(()=>atomicSql({...pkg,rawManifest:pkg.rawManifest+' '}));
});
test('existing receipts, target functions, wrong actor/database or source drift cause zero writes',()=>{
 for(const bad of [{existing:1},{targetsAbsent:false},{baseline:false},{actor:'other'},{database:'other'}]){
  let writes=0;assert.throws(()=>executeMigration(pkg,{json:()=>({...ready,...bad}),execute:()=>writes++}));assert.equal(writes,0);
 }
});
test('one atomic write needs exact receipt and object postchecks before success',()=>{
 const rows=[ready,{count:1,exact:true},{functions:true,baseline:true}],reports=[];let writes=0;
 executeMigration(pkg,{json:()=>rows.shift(),execute:()=>writes++},s=>reports.push(s));
 assert.equal(writes,1);assert.equal(rows.length,0);assert.equal(reports.at(-1),'FLOOR345_OBJECT_POSTCHECK_PASS');
});
for(const receipt of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false},null]){
 test(`uncertain outcome never retries: ${JSON.stringify(receipt)}`,()=>{
  let reads=0,writes=0;const reports=[];
  assert.throws(()=>executeMigration(pkg,{json:()=>{if(reads++===0)return ready;if(receipt===null)throw Error('unavailable');return receipt;},execute:()=>{writes++;throw Error('disconnected');}},s=>reports.push(s)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,2);assert.match(reports[0],/no automatic retry/);
 });
}
test('bad post-receipt or ACL cannot report success',()=>{
 for(const rows of [[ready,{count:0,exact:false}],[ready,{count:1,exact:true},{functions:false,baseline:true}],[ready,{count:1,exact:true},{functions:true,baseline:false}]]){
  const reports=[];assert.throws(()=>executeMigration(pkg,{json:()=>rows.shift(),execute:()=>{}},s=>reports.push(s)));assert.ok(!reports.includes('FLOOR345_OBJECT_POSTCHECK_PASS')); if(reports.length)assert.match(reports[0],/^COMMITTED_EXACT /);
 }
});
test('post-write receipt outage explicitly reports unknown commit without retry',()=>{
 let reads=0,writes=0;const reports=[];
 assert.throws(()=>executeMigration(pkg,{json:()=>{if(reads++===0)return ready;throw Error('offline');},execute:()=>writes++},s=>reports.push(s)),/receipt unavailable/);
 assert.equal(writes,1);assert.equal(reads,2);
 assert.match(reports[0],/receipt=unavailable; commit status unknown; no automatic retry/);
});
function context(){
 const source='a'.repeat(40),controller='b'.repeat(40),owner='PhamGiaVinh';
 return {env:{RELEASE_SHA:source,SOURCE_CHECKOUT_SHA:source,GITHUB_SHA:controller,SOURCE_PR_BASE_SHA:controller,
 GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:owner+'/abcxyzrandomsarghes',
 INITIAL_ACTOR:owner,TRIGGERING_ACTOR:owner,REPOSITORY_OWNER:owner,SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',
 PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'synthetic-test-only',
 MANIFEST_SHA256,CONFIRM_FLOOR_PACKAGE:'APPLY_FLOOR_345_'+source,RECOVERY_BASE_SHA:'c'.repeat(40)},
 receipt:{schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:'c'.repeat(40),snapshotAt:new Date().toISOString(),isolatedRestore:'PASS',tableCountMatch:'PASS',databaseOwnerAndEffectiveAclMatch:true,productionMutation:false,ciphertextSha256:'d'.repeat(64)},
 observed:{sourceSha:source,controllerSha:controller}};
}
test('apply is off without exact dispatch, actor, target, manifest, source and fresh restore approval',()=>{
 const c=context();assert.doesNotThrow(()=>validateApproval('apply',c.env,c.receipt,c.observed));
 for(const patch of [{CONFIRM_FLOOR_PACKAGE:''},{MANIFEST_SHA256:'0'.repeat(64)},{GITHUB_EVENT_NAME:'push'},{INITIAL_ACTOR:'other'},{TRIGGERING_ACTOR:'other'},
 {GITHUB_REF:'refs/heads/other'},{PGHOST:'other'},{PGOPTIONS:'-c role=other'},{SOURCE_PR_BASE_SHA:'0'.repeat(40)},{RELEASE_SHA:'0'.repeat(40)},{SUPABASE_PROJECT_REF:'other'}])
 assert.throws(()=>validateApproval('apply',{...c.env,...patch},c.receipt,c.observed));
 for(const patch of [{databaseOwnerAndEffectiveAclMatch:false},{databaseOwnerAndEffectiveAclMatch:undefined},{isolatedRestore:'FAIL'},{tableCountMatch:'FAIL'},{productionMutation:true},{snapshotAt:new Date(Date.now()-3601000).toISOString()}])
 assert.throws(()=>validateApproval('apply',c.env,{...c.receipt,...patch},c.observed));
 assert.throws(()=>validateApproval('apply',c.env,c.receipt,{...c.observed,controllerSha:'0'.repeat(40)}));
 assert.throws(()=>validateApproval('apply',c.env,c.receipt,{...c.observed,sourceSha:'0'.repeat(40)}));
});

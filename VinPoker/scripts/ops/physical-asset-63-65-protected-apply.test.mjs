import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease,runProtected } from './physical-asset-63-65-protected-apply.mjs';
const sha='a'.repeat(40),base='b'.repeat(40);
const env={RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,GITHUB_SHA:base,GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',
 INITIAL_ACTOR:'owner',TRIGGERING_ACTOR:'owner',REPOSITORY_OWNER:'owner',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',
 PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',
 PGSSLMODE:'require',PGPASSWORD:'local-test-only',RECOVERY_BASE_SHA:base,CONFIRM_FLOOR_PACKAGE:`APPLY_PHYSICAL_ASSET_63_65_${sha}`};
const recovery={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:base,isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),snapshotAt:new Date(Date.now()-1000).toISOString()};
const pending={database:'postgres',actor:'postgres',pending:0,names:0,apis:0};
test('existing owner/main/exact-source/connection and recovery guards remain mandatory',()=>{
 validateRelease(env,recovery,sha,'apply');
 for(const delta of [{RELEASE_SHA:base},{SUPABASE_PROJECT_REF:'other'},{TRIGGERING_ACTOR:'other'},{GITHUB_ACTIONS:'false'},
  {GITHUB_REF:'refs/heads/feature'},{PGHOST:'localhost'},{PGHOSTADDR:'127.0.0.1'},{PGOPTIONS:'override'},{CONFIRM_FLOOR_PACKAGE:'APPLY_OTHER'}])
   assert.throws(()=>validateRelease({...env,...delta},recovery,sha,'apply'));
 for(const delta of [{isolatedRestore:'FAIL'},{tableCountMatch:'FAIL'},{productionMutation:true},
  {sourceSha:sha},{snapshotAt:new Date(Date.now()-3600001).toISOString()}])
   assert.throws(()=>validateRelease(env,{...recovery,...delta},sha,'apply'));
 assert.throws(()=>validateRelease(env,recovery,base,'apply'));
 assert.throws(()=>validateRelease(env,recovery,sha,'unknown'));
});
test('readonly plan cannot invoke write transport',()=>{
 let writes=0;
 runProtected('plan',{json(){return pending;},execute(){writes++;}});
 assert.equal(writes,0);
});
test('partial ledger, existing overload or wrong actor/database stops before any write',()=>{
 for(const delta of [{pending:1},{names:1},{apis:1},{database:'other'},{actor:'service_role'}]){
  let writes=0;
  assert.throws(()=>runProtected('apply',{json(){return {...pending,...delta};},execute(){writes++;}}),/precondition drift/);
  assert.equal(writes,0);
 }
});
test('one qualified atomic write followed by exact postcheck',()=>{
 let reads=0,writes=0;
 runProtected('apply',{json(){return ++reads===1?pending:{receipts:true,object:true};},execute(){writes++;}});
 assert.equal(writes,1);assert.equal(reads,2);
});

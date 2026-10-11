import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRelease} from './tracker-stack-61-protected-apply.mjs';
const sha='a'.repeat(40),base='b'.repeat(40);
const env={RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,GITHUB_SHA:base,GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',INITIAL_ACTOR:'owner',TRIGGERING_ACTOR:'owner',REPOSITORY_OWNER:'owner',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'synthetic-test-value',RECOVERY_BASE_SHA:base,CONFIRM_FLOOR_PACKAGE:`APPLY_TRACKER_STACK_61_${sha}`};
const receipt={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:base,isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),snapshotAt:new Date(Date.now()-1000).toISOString()};
test('workflow binds trusted actor, exact open PR checks and restore artifact',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/tracker-stack-61-protected-apply.yml',import.meta.url),'utf8');
 for(const required of ["github.ref == 'refs/heads/main'",'APPLY_TRACKER_STACK_61_',
 'INITIAL_ACTOR','TRIGGERING_ACTOR','GITHUB_REPOSITORY_OWNER','.head.sha','.state',
 'runtime postgres-17-integrated release-runner-postgres-17 collision-guard reject-sensitive-vars-context',
 'floor-v3-recovery-backup.yml','floor-v3-restore-verification-',
 'RECOVERY_BASE_SHA','dealer-swing-production-critical','vinpoker-production-database-release',
 'tracker-stack-61-protected-apply.mjs plan','tracker-stack-61-protected-apply.mjs apply'])assert.ok(yaml.includes(required),required);
 assert.ok(!yaml.includes('tracker-void-59-protected-apply.mjs'));
 const wrapper=readFileSync(new URL('./tracker-stack-61-protected-apply.mjs',import.meta.url),'utf8');
 for(const content of [yaml,wrapper]){
  assert.ok(!content.includes('tracker-reentry-60'));
  assert.ok(!content.includes('EXACT60'));
 }
 assert.ok(wrapper.includes('EXACT61_PENDING'));
});
test('protected61 requires exact context, checkout, confirmation and restore',()=>{
 validateRelease(env,receipt,sha,'plan');validateRelease(env,receipt,sha,'apply');
 for(const mode of ['push','reset',undefined])assert.throws(()=>validateRelease(env,receipt,sha,mode));
 assert.throws(()=>validateRelease(env,receipt,base,'apply'));
 for(const delta of [{CONFIRM_FLOOR_PACKAGE:''},{CONFIRM_FLOOR_PACKAGE:`APPLY_TRACKER_VOID_59_${sha}`},{PGHOST:'localhost'},{TRIGGERING_ACTOR:'outsider'},{GITHUB_REF:'refs/heads/feature'},{SOURCE_CHECKOUT_SHA:base},{PGOPTIONS:'override'}])assert.throws(()=>validateRelease({...env,...delta},receipt,sha,'apply'));
 for(const delta of [{isolatedRestore:'FAIL'},{sourceSha:sha},{productionMutation:true},{snapshotAt:new Date(Date.now()-7200000).toISOString()}])assert.throws(()=>validateRelease(env,{...receipt,...delta},sha,'apply'));
});

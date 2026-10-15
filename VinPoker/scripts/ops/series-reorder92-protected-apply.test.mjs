import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateRelease} from './series-reorder92-protected-apply.mjs';

test('series92 binds source, owner, target and fresh recovery before either mode',()=>{
 const sha='a'.repeat(40),base='b'.repeat(40);
 const env={RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,GITHUB_SHA:base,GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',INITIAL_ACTOR:'owner',TRIGGERING_ACTOR:'owner',REPOSITORY_OWNER:'owner',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'local-test-only',RECOVERY_BASE_SHA:base,CONFIRM_FLOOR_PACKAGE:`APPLY_SERIES_REORDER_92_${sha}`};
 const recovery={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:base,isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),snapshotAt:new Date(Date.now()-1000).toISOString()};
 validateRelease(env,recovery,sha,'plan');validateRelease(env,recovery,sha,'apply');
 for(const delta of [{SOURCE_CHECKOUT_SHA:base},{TRIGGERING_ACTOR:'other'},{PGHOST:'localhost'},{PGOPTIONS:'override'},{SUPABASE_PROJECT_REF:'other'},{CONFIRM_FLOOR_PACKAGE:`APPLY_DEALER_REST_78_${sha}`}])assert.throws(()=>validateRelease({...env,...delta},recovery,sha,'apply'));
 assert.throws(()=>validateRelease(env,recovery,base,'apply'));
 for(const delta of [{snapshotAt:new Date(Date.now()-3601000).toISOString()},{sourceSha:sha},{isolatedRestore:'FAIL'},{productionMutation:true}])assert.throws(()=>validateRelease(env,{...recovery,...delta},sha,'plan'));
});
test('series92 rejects absent recovery and non-apply mode',()=>{
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'apply'));
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'reset'));
});

test('required actionlint is triggered and actually validates series92 workflow',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/deployment-control-plane-validation.yml',import.meta.url),'utf8');
 assert.ok(yaml.split('.github/workflows/series-reorder92-protected-apply.yml').length>=3,'must appear in both pull-request paths and actionlint command');
 assert.ok(yaml.includes('VinPoker/scripts/ops/series-reorder92-*'),'runner changes must trigger required validation');
 assert.ok(yaml.includes('node --test VinPoker/scripts/ops/series-reorder92-release-plan.test.mjs VinPoker/scripts/ops/series-reorder92-protected-apply.test.mjs'));
 const runtime=readFileSync(new URL('../../../.github/workflows/dealer-checkin-current-schema.yml',import.meta.url),'utf8');
 assert.ok(runtime.includes('createdb -T "$PGDATABASE" vinpoker_ops_series92_release'));
 assert.ok(runtime.includes('node scripts/ops/series-reorder92-release-plan.pg17.mjs'));
});
test('series92 retains protected review, exact source and fresh recovery boundaries',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/series-reorder92-protected-apply.yml',import.meta.url),'utf8');
 for(const item of ['dealer-swing-production-critical','required_reviewers','cancel-in-progress: false','APPLY_SERIES_REORDER_92_','.head.sha','.merge_commit_sha','runtime postgres-17-integrated','floor-v3-recovery-backup.yml','floor-v3-restore-verification-','RECOVERY_BASE_SHA','unzip -Z1','series-reorder92-protected-apply.mjs plan','series-reorder92-protected-apply.mjs apply'])assert.ok(yaml.includes(item),item);
 assert.ok(!yaml.includes('functions deploy'));
});

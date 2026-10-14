import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRelease} from './tracker-manual-75-protected-apply.mjs';
const sha='a'.repeat(40),base='b'.repeat(40);
const env={RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,GITHUB_SHA:base,GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',INITIAL_ACTOR:'owner',TRIGGERING_ACTOR:'owner',REPOSITORY_OWNER:'owner',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'synthetic-test-value',RECOVERY_BASE_SHA:base,CONFIRM_FLOOR_PACKAGE:`APPLY_TRACKER_MANUAL_75_${sha}`};
const receipt={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:base,isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),snapshotAt:new Date(Date.now()-1000).toISOString()};
test('manual75 retains exact owner/source/target/recovery/intention boundary',()=>{
 validateRelease(env,receipt,sha,'plan');validateRelease(env,receipt,sha,'apply');
 for(const mode of ['push','reset',undefined])assert.throws(()=>validateRelease(env,receipt,sha,mode));
 assert.throws(()=>validateRelease(env,receipt,base,'apply'));
 for(const delta of [{CONFIRM_FLOOR_PACKAGE:''},{CONFIRM_FLOOR_PACKAGE:`APPLY_TRACKER_PUBLIC_74_${sha}`},{PGHOST:'localhost'},{TRIGGERING_ACTOR:'outsider'},{GITHUB_REF:'refs/heads/feature'},{SOURCE_CHECKOUT_SHA:base},{PGOPTIONS:'override'},{PGHOSTADDR:'127.0.0.1'},{PGSERVICE:'other'},{SUPABASE_PROJECT_REF:'other'},{PGDATABASE:'other'},{PGUSER:'postgres'}])assert.throws(()=>validateRelease({...env,...delta},receipt,sha,'apply'));
 for(const delta of [{isolatedRestore:'FAIL'},{sourceSha:sha},{productionMutation:true},{snapshotAt:new Date(Date.now()-7200000).toISOString()}])assert.throws(()=>validateRelease(env,{...receipt,...delta},sha,'apply'));
});

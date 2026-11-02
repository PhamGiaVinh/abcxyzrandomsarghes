import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRelease} from './dealer-close79-81-protected-apply.mjs';
test('close79/81 does not accept absent protected context/recovery',()=>{
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'apply'));
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'plan'));
});
test('close79/81 rejects reset and arbitrary execution modes',()=>{
 for(const mode of ['reset','push','deploy','',undefined])assert.throws(()=>validateRelease({},null,'a'.repeat(40),mode),/plan\|apply/);
});
test('valid protected context still requires exact79/81 confirmation and checkout',()=>{
 const sha='a'.repeat(40),base='b'.repeat(40);
 const env={TRANSACTION_EXCEPTION:'79_81_ATOMIC_APPROVED',RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,GITHUB_SHA:base,GITHUB_REF:'refs/heads/main',
  GITHUB_ACTIONS:'true',INITIAL_ACTOR:'owner',TRIGGERING_ACTOR:'owner',REPOSITORY_OWNER:'owner',
  SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',
  PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',
  PGPASSWORD:'local-test-only',RECOVERY_BASE_SHA:base};
 const recovery={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:base,
  isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),
  snapshotAt:new Date(Date.now()-1000).toISOString()};
 validateRelease(env,recovery,sha,'plan');
 assert.throws(()=>validateRelease(env,recovery,sha,'apply'),/confirmation/);
 assert.throws(()=>validateRelease({...env,CONFIRM_FLOOR_PACKAGE:`APPLY_DEALER_CLOSE_79_${sha}`},recovery,sha,'apply'),/confirmation/);
 const approved={...env,CONFIRM_FLOOR_PACKAGE:`APPLY_DEALER_CLOSE_79_81_${sha}`};
 validateRelease(approved,recovery,sha,'apply');
 for(const value of [undefined,'NOT_APPROVED','true'])assert.throws(()=>validateRelease({...approved,TRANSACTION_EXCEPTION:value},recovery,sha,'apply'),/transaction exception/);
 assert.throws(()=>validateRelease(approved,recovery,base,'apply'),/Checkout/);
 assert.throws(()=>validateRelease(approved,{...recovery,isolatedRestore:'FAIL'},sha,'apply'),/recovery/);
});
test('close79/81 workflow retains owner authorization, source checks and recovery provenance',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/dealer-close79-81-protected-apply.yml',import.meta.url),'utf8');
 for(const token of ['INITIAL_ACTOR','TRIGGERING_ACTOR','dealer-swing-production-critical','cancel-in-progress: false',
  'APPLY_DEALER_CLOSE_79_81_','.head.sha','.merge_commit_sha','runtime tracker-dealer-read-only postgres-17-integrated',
  'floor-v3-recovery-backup.yml','floor-v3-restore-verification-','RECOVERY_BASE_SHA','unzip -Z1',
  'dealer-close79-81-protected-apply.mjs plan','dealer-close79-81-protected-apply.mjs apply'])assert.ok(yaml.includes(token),token);
 assert.ok(!yaml.includes('functions deploy'));
 assert.ok(yaml.includes('default: NOT_APPROVED'));
 assert.ok(yaml.includes('test "$TRANSACTION_EXCEPTION" = "79_81_ATOMIC_APPROVED"'));
 assert.ok(!yaml.includes('dealer-close79-protected-apply.mjs'));
});

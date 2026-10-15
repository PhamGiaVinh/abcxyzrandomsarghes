import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateRelease} from './dealer-rest78-protected-apply.mjs';
test('rest78 rejects absent recovery and non-apply mode',()=>{
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'apply'));
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'reset'));
});
test('rest78 retains owner authorization, exact source and fresh recovery boundaries',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/dealer-rest78-protected-apply.yml',import.meta.url),'utf8');
 for(const item of ['dealer-swing-production-critical','INITIAL_ACTOR','TRIGGERING_ACTOR','cancel-in-progress: false','APPLY_DEALER_REST_78_','.head.sha','.merge_commit_sha','runtime postgres-17-integrated','floor-v3-recovery-backup.yml','floor-v3-restore-verification-','RECOVERY_BASE_SHA','unzip -Z1','dealer-rest78-protected-apply.mjs plan','dealer-rest78-protected-apply.mjs apply'])assert.ok(yaml.includes(item),item);
 assert.ok(!yaml.includes('functions deploy'));
});

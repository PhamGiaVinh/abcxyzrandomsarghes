import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateRelease} from './dealer-close79-protected-apply.mjs';
test('close79 rejects absent recovery and non-apply mode',()=>{
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'apply'));
 assert.throws(()=>validateRelease({},null,'a'.repeat(40),'reset'));
});
test('close79 retains protected review, exact source and fresh recovery boundaries',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/dealer-close79-protected-apply.yml',import.meta.url),'utf8');
 for(const item of ['dealer-swing-production-critical','required_reviewers','cancel-in-progress: false','APPLY_DEALER_CLOSE_79_','.head.sha','.merge_commit_sha','runtime postgres-17-integrated','floor-v3-recovery-backup.yml','floor-v3-restore-verification-','RECOVERY_BASE_SHA','unzip -Z1','dealer-close79-protected-apply.mjs plan','dealer-close79-protected-apply.mjs apply'])assert.ok(yaml.includes(item),item);
 assert.ok(!yaml.includes('functions deploy'));
});

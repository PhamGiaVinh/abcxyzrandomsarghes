import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('./cashier-tour-real-e2e.sh', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/cashier-tour-real-e2e.yml', import.meta.url), 'utf8');

test('historical mode remains default and requires original baseline', () => {
  assert.ok(script.includes('CASHIER_SCHEMA_MODE:-pre03'));
  assert.ok(workflow.includes('capture_id=35982674365'));
  assert.ok(script.includes('"$schema_mode" == pre03 && "$baseline_state" != \'t|t\''));
});

test('current mode pins reviewed bytes and does not replay historical writers', () => {
  assert.ok(script.includes('expected_schema_sha=d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a'));
  assert.ok(script.includes('"$actual_schema_sha" != "$expected_schema_sha"'));
  assert.ok(script.includes('elif [[ "$baseline_state" != \'t|f\' ]]'));
  const migrationBlock = script.slice(script.indexOf("cashier_migration="), script.indexOf('applied_state='));
  assert.ok(migrationBlock.includes('if [[ "$schema_mode" == pre03 ]]; then'));
  assert.ok(migrationBlock.includes('<"$repo_root/supabase/migrations/$cashier_migration"'));
  assert.ok(migrationBlock.indexOf('if [[ "$schema_mode" == pre03 ]]; then') < migrationBlock.indexOf('<"$repo_root/supabase/migrations/$cashier_migration"'));
  assert.ok(workflow.includes('recovery_id=38275767630'));
  assert.ok(workflow.includes('not pre03 migration proof'));
  assert.ok(workflow.includes('.workflow_id == 322144993 and .head_branch == "main"'));
  assert.ok(workflow.includes('.head_sha == "09cff8a829caf3f514a615b231ab96f4ed238757"'));
  assert.ok(workflow.includes('--operations-recovery-provenance'));
});

test('both paths retain money/refund and network/secret/cron guards', () => {
  for (const marker of ['Unexpected remote credential', 'Disposable cron guard', 'cashier_tour_money_v1.sql', 'cashier_no_floor=on', 'cashier-tour-real.spec.ts']) {
    assert.ok(script.includes(marker), marker);
  }
  assert.ok(script.indexOf('Unsupported Cashier schema mode') < script.indexOf('test_root='));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = readFileSync(new URL('./cashier-tour-real-e2e.sh', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/cashier-tour-real-e2e.yml', import.meta.url), 'utf8');

function rejectedPreflight(mode) {
  const filename = fileURLToPath(new URL('./cashier-tour-real-e2e.sh', import.meta.url));
  const env = { ...process.env, CASHIER_SCHEMA_MODE: mode, SCHEMA_ARTIFACT_DIRECTORY: '/missing-cashier-schema' };
  if (process.platform === 'win32') {
    const path = filename.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/');
    return spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', `CASHIER_SCHEMA_MODE=${mode}`, 'SCHEMA_ARTIFACT_DIRECTORY=/missing-cashier-schema', 'bash', path], { encoding: 'utf8' });
  }
  return spawnSync('bash', [filename], { encoding: 'utf8', env });
}

test('invalid mode fails before allocating a test environment', () => {
  const result = rejectedPreflight('unsupported');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported Cashier schema mode/);
});

test('current mode rejects missing schema before Docker or application loading', () => {
  const result = rejectedPreflight('current');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Verified schema-only baseline artifact is required/);
});

test('private dependencies use digest-matching source bodies and restricted grants', () => {
  const output = join(mkdtempSync(join(tmpdir(), 'cashier-dependency-test-')), 'dependencies.sql');
  const generator = fileURLToPath(new URL('./prepare-cashier-runtime-dependencies.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [generator, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sql = readFileSync(output, 'utf8');
  assert.ok(sql.includes("RAISE EXCEPTION 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED'"));
  assert.ok(sql.includes('p_club_id = ANY(r.allowed_club_ids)'));
  assert.ok(sql.includes('storage.foldername(p_name)'));
  assert.ok(sql.includes('FROM PUBLIC, anon, authenticated, service_role;'));
  assert.ok(!sql.includes('SELECT false;'));
  assert.ok(!sql.includes('ALTER TABLE'));
});

function dependencyDriftResult(transform) {
  const root = mkdtempSync(join(tmpdir(), 'cashier-dependency-drift-'));
  const scripts = join(root, 'scripts', 'ops');
  const migrations = join(root, 'supabase', 'pending-migrations');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(migrations, { recursive: true });
  const generator = join(scripts, 'prepare-cashier-runtime-dependencies.mjs');
  writeFileSync(generator, readFileSync(new URL('./prepare-cashier-runtime-dependencies.mjs', import.meta.url)));
  for (const name of ['20260924165219_centerpoint_tournament_ops_release_v1.sql', '20260924065041_tv_layout_editor_v1.sql']) {
    const source = readFileSync(new URL(`../../supabase/pending-migrations/${name}`, import.meta.url), 'utf8');
    writeFileSync(join(migrations, name), name.includes('centerpoint_tournament') ? transform(source) : source);
  }
  const output = join(root, 'dependencies.sql');
  const result = spawnSync(process.execPath, [generator, output], { encoding: 'utf8' });
  return { result, output };
}

test('dependency header-only security drift is rejected without generating SQL', () => {
  const { result, output } = dependencyDriftResult(source => source.replace('SECURITY DEFINER', 'SECURITY INVOKER'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed signature\/security metadata mismatch/);
  assert.equal(existsSync(output), false);
});

test('dependency business-body drift is rejected without generating SQL', () => {
  const { result, output } = dependencyDriftResult(source => source.replace('SELECT r.enabled', 'SELECT true'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed live body mismatch/);
  assert.equal(existsSync(output), false);
});

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRelease } from './tracker-voice-70-71-protected-apply.mjs';
const sha = 'a'.repeat(40), base = 'b'.repeat(40);
const env = { RELEASE_SHA: sha, SOURCE_CHECKOUT_SHA: sha, GITHUB_SHA: base, GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTIONS: 'true', INITIAL_ACTOR: 'owner', TRIGGERING_ACTOR: 'owner', REPOSITORY_OWNER: 'owner',
  SUPABASE_PROJECT_REF: 'orlesggcjamwuknxwcpk', PGHOST: 'aws-1-ap-southeast-2.pooler.supabase.com',
  PGPORT: '5432', PGUSER: 'postgres.orlesggcjamwuknxwcpk', PGDATABASE: 'postgres', PGSSLMODE: 'require',
  PGPASSWORD: 'synthetic-test-value', RECOVERY_BASE_SHA: base, CONFIRM_FLOOR_PACKAGE: `APPLY_TRACKER_VOICE_70_71_${sha}` };
const receipt = { schemaVersion: 1, kind: 'vinpoker-restore-verification', sourceSha: base,
  isolatedRestore: 'PASS', tableCountMatch: 'PASS', productionMutation: false,
  ciphertextSha256: 'c'.repeat(64), snapshotAt: new Date(Date.now() - 1000).toISOString() };
test('protected70/71 requires exact actor, target, source, recovery and intent', () => {
  validateRelease(env, receipt, sha, 'plan'); validateRelease(env, receipt, sha, 'apply');
  for (const mode of ['push', 'reset', undefined]) assert.throws(() => validateRelease(env, receipt, sha, mode));
  assert.throws(() => validateRelease(env, receipt, base, 'apply'));
  for (const delta of [{ CONFIRM_FLOOR_PACKAGE: '' }, { CONFIRM_FLOOR_PACKAGE: `APPLY_FLOOR_ROSTER_62_${sha}` },
    { PGHOST: 'localhost' }, { TRIGGERING_ACTOR: 'outsider' }, { GITHUB_REF: 'refs/heads/feature' },
    { SOURCE_CHECKOUT_SHA: base }, { PGOPTIONS: 'override' }, { PGHOSTADDR: '127.0.0.1' }, { PGSERVICE: 'other' },
    { SUPABASE_PROJECT_REF: 'other' }, { PGDATABASE: 'other' }, { PGUSER: 'postgres' }]) {
    assert.throws(() => validateRelease({ ...env, ...delta }, receipt, sha, 'apply'));
  }
  for (const delta of [{ isolatedRestore: 'FAIL' }, { sourceSha: sha }, { productionMutation: true },
    { snapshotAt: new Date(Date.now() - 7200000).toISOString() }]) assert.throws(() => validateRelease(env, { ...receipt, ...delta }, sha, 'apply'));
});
test('workflow retains source checks, recovery and protected human environment', () => {
  const yaml = readFileSync(new URL('../../../.github/workflows/tracker-voice-70-71-protected-apply.yml', import.meta.url), 'utf8');
  for (const required of ["github.ref == 'refs/heads/main'", 'APPLY_TRACKER_VOICE_70_71_', 'INITIAL_ACTOR',
    'TRIGGERING_ACTOR', 'GITHUB_REPOSITORY_OWNER', '.head.sha', '.state', '.merged', '.merge_commit_sha',
    'compare/$merge_sha...$GITHUB_SHA', 'identical ||',
    'runtime postgres-17-integrated release-runner-postgres-17 collision-guard reject-sensitive-vars-context floor-table-control-v3-server-contract',
    'floor-v3-recovery-backup.yml', 'floor-v3-restore-verification-', 'RECOVERY_BASE_SHA',
    'dealer-swing-production-critical', 'vinpoker-production-database-release',
    'tracker-voice-70-71-protected-apply.mjs plan', 'tracker-voice-70-71-protected-apply.mjs apply']) assert.ok(yaml.includes(required), required);
  assert.ok(yaml.includes('for status in in_progress waiting queued'));
  assert.ok(yaml.includes('gh api --paginate'));
  assert.ok(yaml.includes('runs?status=$status&per_page=100'));
  assert.ok(!yaml.includes('floor-roster-62-protected-apply.mjs'));
  for (const gate of ['--paginate --slurp', '.app.slug=="github-actions"', 'required_reviewers',
    'unzip -Z1', '= recovery-verification.json']) assert.ok(yaml.includes(gate), gate);
  const runner = readFileSync(new URL('./tracker-voice-70-71-protected-apply.mjs', import.meta.url), 'utf8');
  assert.ok(runner.includes('EXACT_VOICE70_71_PENDING')); assert.ok(!runner.includes('EXACT64_PENDING'));
});

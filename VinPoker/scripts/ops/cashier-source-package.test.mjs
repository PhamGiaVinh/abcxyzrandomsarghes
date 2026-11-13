import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualifiedSource342, selectCashierSchemaMode } from './select-cashier-schema-mode.mjs';
import { validateSourcePackageEvidence } from './cashier-source-package-evidence.mjs';

const source = fileURLToPath(new URL('../../../', import.meta.url));
const repo = mkdtempSync(join(tmpdir(), 'cashier-exact-source-'));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const original = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' });
git('init', '--quiet');
git('config', 'user.name', 'Isolated policy fixture');
git('config', 'user.email', 'ci@example.invalid');
writeFileSync(join(repo, '.git/objects/info/alternates'), resolve(source, original('rev-parse', '--git-common-dir').trim(), 'objects').replaceAll('\\', '/') + '\n');
const root = 'VinPoker/scripts/ops/';
const policyPath = root + 'cashier-source342-344-qualified-scope.json';
const receiptPath = root + 'fixtures/cashier-source342-344-runtime-receipt.json';
const policy = JSON.parse(readFileSync(join(source, policyPath)));
const guards = [policyPath, receiptPath, root + 'select-cashier-schema-mode.mjs',
  root + 'cashier-schema-mode.test.mjs',
  root + 'cashier-source-package-evidence.mjs', root + 'cashier-source-package.test.mjs',
  '.github/workflows/cashier-tour-real-e2e.yml'];
function set(path, bytes, mode = '100644') {
  const oid = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: bytes, encoding: 'utf8' }).trim();
  git('update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`);
}
function commit(parent) { return git('commit-tree', git('write-tree').trim(), '-p', parent, '-m', 'isolated policy fixture').trim(); }
const baseline = '3c9a965edb4c96d34263c09db42dc11c5d6182c1';
const candidate = 'c69bce72ca98332ac4740808b05db01bf7bed398';
git('read-tree', baseline);
for (const path of guards) set(path, readFileSync(join(source, path)));
const base = commit(baseline);
git('read-tree', candidate);
for (const path of guards) set(path, readFileSync(join(source, path)));
const head = commit(base);
function pages(h = head, b = base) {
  const fields = git('diff', '--no-renames', '--name-status', '-z', b, h).split('\0'); fields.pop();
  const files = [];
  for (let i = 0; i < fields.length; i += 2) files.push({ filename: fields[i + 1], status: { A: 'added', M: 'modified', D: 'removed' }[fields[i]] });
  return [files];
}
function mutation(change) {
  git('read-tree', head); change(); const h = commit(base);
  return { pages: pages(h), context: { repo, base, head: h } };
}
test('exact committed package selects current-source342, not historical proof', () => {
  assert.equal(selectCashierSchemaMode(pages(), { repo, base, head }), 'current-source342');
});
test('unknown SQL, missing/renamed/symlink SQL, catalog drift and historical edits fail closed', () => {
  const sql = policy.migrationScope.find(f => f.status === 'A').path;
  for (const change of [
    () => set('VinPoker/supabase/migrations/unknown.sql', 'select 1;'),
    () => git('update-index', '--force-remove', sql),
    () => set(sql, original('show', `${candidate}:${sql}`) + '\n-- changed'),
    () => set(sql, 'elsewhere.sql', '120000'),
    () => { git('update-index', '--force-remove', sql); set('VinPoker/supabase/migrations/renamed.sql', 'select 1;'); },
    () => set(policy.migrationScope[0].path, '{}'),
    () => set('VinPoker/supabase/migrations/20270115000003_cashier_tour_money_v1.sql', '-- changed'),
  ]) {
    const m = mutation(change);
    assert.equal(selectCashierSchemaMode(m.pages, m.context), 'pre03');
  }
});
test('head cannot self-approve policy, receipt, selector, workflow or evidence checks', () => {
  for (const path of [...guards, root + 'cashier-hud35-qualified-scope.json', root + 'fixtures/cashier-ci-hud35-qualified-receipt-20261107.json']) {
    const m = mutation(() => set(path, '{}'));
    assert.throws(() => qualifiedSource342(m.pages.flat(), m.context), error => {
      assert.match(error.message, /trusted guard/);
      assert.ok(error.message.length < 250, 'Do not render large source-buffer diffs');
      return true;
    });
  }
});
test('runtime drift and incomplete or stale API pages reject the exception', () => {
  const m = mutation(() => set(policy.runtimeFiles[0].path, '// changed'));
  assert.throws(() => qualifiedSource342(m.pages.flat(), m.context), /Runtime guard drift/);
  assert.throws(() => selectCashierSchemaMode([pages()[0].slice(1)], { repo, base, head }), /tree diff/);
  assert.throws(() => selectCashierSchemaMode([[...pages()[0], pages()[0][0]]], { repo, base, head }), /Duplicate/);
  assert.throws(() => selectCashierSchemaMode(pages(), { repo, base, head: base }), /tree diff/);
});
test('wrong-origin evidence in protected policy is rejected', () => {
  for (const change of [p => { p.proof.actor = 'other'; }, p => { p.proof.run = 1; },
    p => { p.proof.workflowId = 1; }, p => { p.proof.conclusion = 'failure'; },
    p => { p.proof.artifact.sha256 = '0'.repeat(64); }, p => { delete p.proof; }]) {
    const p = structuredClone(policy); change(p);
    git('read-tree', base); set(policyPath, JSON.stringify(p)); const b = commit(base);
    git('read-tree', head); set(policyPath, JSON.stringify(p)); const h = commit(b);
    assert.throws(() => qualifiedSource342(pages(h, b).flat(), { repo, base: b, head: h }));
  }
});
test('missing candidate receipt, wrong body/ACL and unserved batch never pass', () => {
  const receipt = JSON.parse(readFileSync(join(source, receiptPath)));
  const fixtures = Object.fromEntries(receipt.receipts.map(r => [r.file, r.receipt]));
  fixtures['operations-audience-http.json'] = { phase: 'passed', productionChanged: false,
    sourceBatchModeVerified: true, servingSourceBatchRpcCalls: 1, checks: Object.fromEntries([
      'zeroErrors', 'atLeast30Seconds', 'allViewers', 'sourceBatchModeAndServingUsage',
      'allSawLaterTableRevision', 'tableP95Within3Seconds', 'markerToScopedDetailP95Within3Seconds',
      'tableSpecificSourceDeliveryVerified', 'publicationMaxWithin5Seconds'].map(k => [k, true])) };
  assert.equal(validateSourcePackageEvidence(name => fixtures[name]), true);
  for (const change of [
    f => { delete f[receipt.receipts[0].file]; },
    f => { f[receipt.receipts[1].file].candidateDefinitionMd5 = 'bad'; },
    f => { f[receipt.receipts[2].file].metadata = false; },
    f => { f['operations-audience-http.json'].servingSourceBatchRpcCalls = 0; },
    f => { delete f['operations-audience-http.json'].checks.tableSpecificSourceDeliveryVerified; },
  ]) { const f = structuredClone(fixtures); change(f); assert.throws(() => validateSourcePackageEvidence(name => f[name])); }
});
test('exact package workflow enables all three probes and requires runtime receipts', () => {
  const workflow = readFileSync(join(source, '.github/workflows/cashier-tour-real-e2e.yml'), 'utf8');
  for (const name of ['SOURCE_GENERATION', 'PENDING_SOURCE', 'SOURCE_BATCH']) {
    assert.match(workflow, new RegExp(`LOCAL_${name}_PROBE:.*outputs.package == 'source342'`));
  }
  assert.ok(workflow.includes('node scripts/ops/cashier-source-package-evidence.mjs output/operations-latency'));
});

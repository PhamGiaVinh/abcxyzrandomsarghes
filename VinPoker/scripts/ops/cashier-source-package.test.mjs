import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualifiedSource342, selectCashierSchemaMode } from './select-cashier-schema-mode.mjs';
import { validateSourcePackageEvidence, validatePolicyBootstrapScope, policyBootstrapFiles } from './cashier-source-package-evidence.mjs';

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
  root + 'cashier-source-package-evidence.mjs', root + 'cashier-source-package.test.mjs',
  '.github/workflows/cashier-tour-real-e2e.yml'];
function set(path, bytes, mode = '100644') {
  const oid = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: bytes, encoding: 'utf8' }).trim();
  git('update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`);
}
function commit(parent) { return git('commit-tree', git('write-tree').trim(), '-p', parent, '-m', 'isolated policy fixture').trim(); }
const baseline = '3c9a965edb4c96d34263c09db42dc11c5d6182c1';
const candidate = 'c69bce72ca98332ac4740808b05db01bf7bed398';
// Carry the already released Floor345 catalog/file through both fixture sides.
// The only newly admitted SQL remains the exact original342–344 package.
const floorBase = '556b474dbf7b82b791889fa31f6896c21667cb0d';
const integrated = '17e6d9b5218ce3d603c05d71e2e401573f42bc64';
const catalog = policy.migrationScope[0].path;
const floor345 = 'VinPoker/supabase/migrations/20270128000345_floor_operator_fast_bust_v1.sql';
git('read-tree', baseline);
set(catalog, original('show', `${floorBase}:${catalog}`));
set(floor345, original('show', `${floorBase}:${floor345}`));
for (const path of guards) set(path, readFileSync(join(source, path)));
const base = commit(baseline);
git('read-tree', candidate);
set(catalog, original('show', `${integrated}:${catalog}`));
set(floor345, original('show', `${floorBase}:${floor345}`));
for (const path of guards) set(path, readFileSync(join(source, path)));
// Preserve the candidate's additional operational safety cases when it inherits
// the policy fixture correction; do not overwrite them with the older base test.
const legacyTest = root + 'cashier-schema-mode.test.mjs';
let mergedTest = original('show', `${candidate}:${legacyTest}`);
const fixtureStart = mergedTest.indexOf("// Preserve the Tracker branch's extra operational inputs/checks when integrating");
const fixtureEnd = mergedTest.indexOf("git('read-tree', policy.runtimeInputs.candidateSha);", fixtureStart);
assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart);
mergedTest = mergedTest.slice(0, fixtureStart)
  + '// Model an unchanged protected-base workflow. New policy steps must not be\n'
  + '// union-merged into the historical integration fixture and self-approved.\n'
  + mergedTest.slice(fixtureEnd);
mergedTest = mergedTest.replace('setBlob(workflowPath, integratedWorkflow);\n', '')
  .replaceAll('setBlob(path, readFileSync(join(sourceRoot, path)));',
    "setBlob(path, path === receiptFile ? sourceGit('show', `HEAD:${path}`) : readFileSync(join(sourceRoot, path)));");
set(legacyTest, mergedTest);
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
    () => set(floor345, '-- changed released Floor345'),
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
  for (const path of [policy.runtimeFiles[0].path, legacyTest]) {
    const m = mutation(() => set(path, '// changed'));
    assert.throws(() => qualifiedSource342(m.pages.flat(), m.context), /Runtime guard drift/);
    assert.equal(selectCashierSchemaMode(m.pages, m.context), 'pre03');
  }
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
  fixtures['operations-audience-http.json'] = { workloadModel: 'selected-table', phase: 'passed', productionChanged: false,
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
    f => { f['operations-audience-http.json'].workloadModel = 'grid-detail-stress'; },
    f => { delete f['operations-audience-http.json'].checks.tableSpecificSourceDeliveryVerified; },
  ]) { const f = structuredClone(fixtures); change(f); assert.throws(() => validateSourcePackageEvidence(name => f[name])); }
});
test('exact package workflow enables all three probes and requires runtime receipts', () => {
  const workflow = readFileSync(join(source, '.github/workflows/cashier-tour-real-e2e.yml'), 'utf8');
  for (const name of ['SOURCE_GENERATION', 'PENDING_SOURCE', 'SOURCE_BATCH']) {
    assert.match(workflow, new RegExp(`LOCAL_${name}_PROBE:.*outputs.package == 'source342'`));
  }
  assert.ok(workflow.includes('node scripts/ops/cashier-source-package-evidence.mjs "$runtime_root/output/operations-latency"'));
  assert.match(workflow, /LOCAL_OPERATIONS_AUDIENCE_MODEL:.*outputs.package == 'source342'.*pull_request.number == 1635.*'selected-table'/);
});

test('policy bootstrap admits only the exact policy-only PR and rejects unknown SQL or historical mode', () => {
  const context = { repository: 'PhamGiaVinh/abcxyzrandomsarghes', number: 1635, mode: 'current', sourcePackage: 'none' };
  assert.equal(validatePolicyBootstrapScope(policyBootstrapFiles, context), true);
  for (const patch of [{ repository: 'other/repo' }, { number: 1634 }, { mode: 'pre03' }, { sourcePackage: 'source342' }]) {
    assert.throws(() => validatePolicyBootstrapScope(policyBootstrapFiles, { ...context, ...patch }));
  }
  for (const files of [policyBootstrapFiles.slice(1), [...policyBootstrapFiles, policyBootstrapFiles[0]],
    [...policyBootstrapFiles, ['VinPoker/supabase/migrations/unknown.sql', 'A']],
    policyBootstrapFiles.map((f, i) => i ? f : [f[0], 'D'])]) {
    assert.throws(() => validatePolicyBootstrapScope(files, context));
  }
});

test('policy bootstrap CLI validates real committed diff before creating any runtime fixture', () => {
  git('read-tree', baseline);
  for (const path of guards) set(path, readFileSync(join(source, path)));
  set(legacyTest, readFileSync(join(source, legacyTest)));
  const policyHead = commit(baseline);
  const args = [join(source, root, 'cashier-source-package-evidence.mjs'), '--bootstrap-scope',
    'PhamGiaVinh/abcxyzrandomsarghes', '1635', 'current', 'none', baseline, policyHead];
  const output = execFileSync(process.execPath, args, { cwd: repo, encoding: 'utf8' });
  assert.match(output, /Exact policy-only integration fixture permitted/);
  set('VinPoker/supabase/migrations/unknown.sql', 'select 1;');
  const changed = commit(policyHead);
  assert.throws(() => execFileSync(process.execPath, [...args.slice(0, -1), changed], { cwd: repo, stdio: 'pipe' }));
  const workflow = readFileSync(join(source, '.github/workflows/cashier-tour-real-e2e.yml'), 'utf8');
  assert.match(workflow, /POLICY_INTEGRATION_PR:.*pull_request.number == 1635/);
  assert.ok(workflow.indexOf('--bootstrap-scope') < workflow.indexOf('git worktree add --detach'));
  assert.ok(workflow.includes('"runtimeSha":"c69bce72ca98332ac4740808b05db01bf7bed398"'));
});

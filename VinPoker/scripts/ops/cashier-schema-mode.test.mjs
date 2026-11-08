import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectCashierSchemaMode, qualifiedHud35 } from './select-cashier-schema-mode.mjs';

const script = readFileSync(new URL('./cashier-tour-real-e2e.sh', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/cashier-tour-real-e2e.yml', import.meta.url), 'utf8');

function rejectedPreflight(mode) {
  const filename = fileURLToPath(new URL('./cashier-tour-real-e2e.sh', import.meta.url));
  const env = { ...process.env, CASHIER_SCHEMA_MODE: mode, SCHEMA_ARTIFACT_DIRECTORY: '/missing-cashier-schema' };
  if (process.platform === 'win32') {
    return spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', `CASHIER_SCHEMA_MODE=${mode}`, 'SCHEMA_ARTIFACT_DIRECTORY=/missing-cashier-schema', 'bash', '-s'], { encoding: 'utf8', input: script.replaceAll('\r\n', '\n') });
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
  assert.ok(workflow.includes('gh api --paginate --slurp'));
  assert.ok(workflow.includes('git show "$BASE_SHA:VinPoker/scripts/ops/select-cashier-schema-mode.mjs"'));
  assert.ok(workflow.includes('node "$trusted_selector" "$GITHUB_WORKSPACE" "$BASE_SHA" "$HEAD_SHA"'));
  assert.ok(workflow.includes('fetch-depth: 0'));
});

// Real committed Git trees, using the actual qualified PR1600 SQL and receipt.
// Full-history checkout is mandatory in CI; no network or production access.
const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'cashier-qualified-tree-'));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
const git = (...args) => execFileSync('git', ['-C', fixtureRoot, ...args], { encoding: 'utf8' });
const sourceGit = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' });
git('init', '--quiet');
git('config', 'user.name', 'Isolated CI fixture');
git('config', 'user.email', 'ci@example.invalid');
const common = sourceGit('rev-parse', '--git-common-dir').trim();
writeFileSync(join(fixtureRoot, '.git', 'objects', 'info', 'alternates'), resolve(sourceRoot, common, 'objects').replaceAll('\\', '/') + '\n');
const policyFile = 'VinPoker/scripts/ops/cashier-hud35-qualified-scope.json';
const receiptFile = 'VinPoker/scripts/ops/fixtures/cashier-ci-hud35-qualified-receipt-20261107.json';
const policy = JSON.parse(readFileSync(join(sourceRoot, policyFile)));
const baseline = 'ea3844085ecfd34b7b21ba19160317e57db4637d';
function setBlob(path, bytes, mode = '100644') {
  const oid = execFileSync('git', ['-C', fixtureRoot, 'hash-object', '-w', '--stdin'], { input: bytes, encoding: 'utf8' }).trim();
  git('update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`);
}
function commitTree(parent) {
  return git('commit-tree', git('write-tree').trim(), ...(parent ? ['-p', parent] : []), '-m', 'isolated test').trim();
}
git('read-tree', baseline);
for (const path of [policyFile, receiptFile, 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs', '.github/workflows/cashier-tour-real-e2e.yml']) {
  setBlob(path, readFileSync(join(sourceRoot, path)));
}
const trustedBase = commitTree(baseline);
// Preserve the Tracker branch's extra operational inputs/checks when integrating
// the trusted-base selector. Only this exact combined workflow may differ.
const workflowPath = '.github/workflows/cashier-tour-real-e2e.yml';
const mergePaths = ['ours.yml', 'base.yml', 'candidate.yml'].map(name => join(fixtureRoot, name));
writeFileSync(mergePaths[0], workflow.replace(/\r\n?/g, '\n'));
writeFileSync(mergePaths[1], sourceGit('show', `${baseline}:${workflowPath}`).replace(/\r\n?/g, '\n'));
writeFileSync(mergePaths[2], sourceGit('show', `${policy.runtimeInputs.candidateSha}:${workflowPath}`).replace(/\r\n?/g, '\n'));
const integratedWorkflow = git('merge-file', '-p', '--union', ...mergePaths)
  .replace('          node --test scripts/ops/cashier-schema-mode.test.mjs supabase/pending-tests/fake-sepay-server.test.mjs\n', '');
git('read-tree', policy.runtimeInputs.candidateSha);
for (const path of [policyFile, receiptFile, 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs', '.github/workflows/cashier-tour-real-e2e.yml']) {
  setBlob(path, readFileSync(join(sourceRoot, path)));
}
setBlob(workflowPath, integratedWorkflow);
const qualifiedHead = commitTree(trustedBase);
function pagesFor(head, base = trustedBase) {
  const fields = git('diff', '--no-renames', '--name-status', '-z', base, head).split('\0');
  fields.pop();
  const files = [];
  for (let i = 0; i < fields.length; i += 2) files.push({ filename: fields[i + 1], status: { A: 'added', M: 'modified', D: 'removed' }[fields[i]] });
  return [files];
}
const context = { repo: fixtureRoot, base: trustedBase, head: qualifiedHead };
function mutation(change) {
  git('read-tree', qualifiedHead);
  change();
  const head = commitTree(trustedBase);
  return { head, files: pagesFor(head).flat(), context: { ...context, head } };
}
test('complete actual qualified35 package selects current with committed provenance', () => {
  assert.equal(qualifiedHud35(pagesFor(qualifiedHead).flat(), context), true);
  assert.equal(selectCashierSchemaMode(pagesFor(qualifiedHead), context), 'current');
});
test('unknown, partial, altered SQL, symlinks, catalog and historical changes reject qualification', () => {
  const first = policy.scope.newSqlFiles[0].path;
  const historical = 'VinPoker/supabase/migrations/20270115000003_cashier_tour_money_v1.sql';
  for (const change of [
    () => setBlob('VinPoker/supabase/migrations/unknown.sql', 'SELECT 1;'),
    () => git('update-index', '--force-remove', first),
    () => setBlob(first, sourceGit('show', `${policy.scope.candidateSha}:${first}`) + '\n-- changed'),
    () => setBlob(first, 'target.sql', '120000'),
    () => setBlob(policy.scope.catalogMetadata.path, '{}'),
    () => setBlob(historical, '-- altered historical writer'),
    () => git('update-index', '--force-remove', historical),
    () => { git('update-index', '--force-remove', first); setBlob('VinPoker/supabase/migrations/renamed.sql', 'SELECT 1;'); },
  ]) {
    const m = mutation(change);
    assert.throws(() => qualifiedHud35(m.files, m.context));
  }
});
test('head cannot rewrite policy, proof, validator or workflow to exempt itself', () => {
  for (const path of [policyFile, receiptFile, 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs', '.github/workflows/cashier-tour-real-e2e.yml']) {
    const m = mutation(() => setBlob(path, '{}'));
    assert.throws(() => qualifiedHud35(m.files, m.context), /trusted guard/);
  }
});
test('runtime runner, browser test and executable fixtures cannot be weakened', () => {
  for (const path of ['VinPoker/scripts/ops/cashier-tour-real-e2e.sh', 'VinPoker/e2e/cashier-tour-real.spec.ts', 'VinPoker/playwright.config.ts', 'VinPoker/supabase/pending-tests/fake-sepay-server.mjs']) {
    const m = mutation(() => setBlob(path, '// no-op'));
    assert.throws(() => qualifiedHud35(m.files, m.context), /Runtime guard drift/);
  }
});
test('wrong base/head, omitted API paths, duplicate paths, unsupported status and renames fail closed', () => {
  const files = pagesFor(qualifiedHead).flat();
  assert.throws(() => qualifiedHud35(files, { ...context, head: trustedBase }), /tree diff/);
  assert.throws(() => qualifiedHud35(files, { ...context, base: 'main;echo unsafe' }), /Exact base/);
  assert.throws(() => qualifiedHud35(files.slice(1), context), /tree diff/);
  assert.throws(() => selectCashierSchemaMode([[{ filename: 'VinPoker/src/stale.ts', status: 'modified' }]], context), /tree diff/);
  assert.throws(() => selectCashierSchemaMode([[...files, files[0]]], context), /Duplicate/);
  assert.throws(() => qualifiedHud35(files.map((f, i) => i ? f : { ...f, status: 'copied' }), context), /tree diff/);
  const renamed = files.map(f => f.filename === policy.scope.newSqlFiles[0].path ? { ...f, previous_filename: 'old.sql' } : f);
  assert.throws(() => qualifiedHud35(renamed, context), /Renames/);
});
test('missing, failed or wrong-origin trusted proof and checksum drift are rejected', () => {
  for (const change of [
    p => { delete p.proof; },
    p => { p.proof.conclusion = 'failure'; },
    p => { p.proof.actor = 'untrusted'; },
    p => { p.proof.workflowId = 1; },
    p => { p.proof.receiptSha256 = '0'.repeat(64); },
    p => { p.runtimeInputs.kind = 'NATIVE_TEST_MASQUERADING_AS_BROWSER_PROOF'; },
  ]) {
    const altered = structuredClone(policy);
    change(altered);
    git('read-tree', trustedBase);
    setBlob(policyFile, JSON.stringify(altered));
    const base = commitTree(trustedBase);
    git('read-tree', qualifiedHead);
    setBlob(policyFile, JSON.stringify(altered));
    const head = commitTree(base);
    assert.throws(() => qualifiedHud35(pagesFor(head, base).flat(), { repo: fixtureRoot, base, head }));
  }
});
test('line ending normalization alone preserves qualified SQL', () => {
  const path = policy.scope.newSqlFiles[0].path;
  const m = mutation(() => setBlob(path, sourceGit('show', `${policy.scope.candidateSha}:${path}`).replace(/\r\n?/g, '\n').replaceAll('\n', '\r\n')));
  assert.equal(qualifiedHud35(m.files, m.context), true);
});

test('migration changes and rename out require historical proof across pages', () => {
  for (const directory of ['migrations/', 'migration-archive/', 'pending-migrations/']) {
    const oldPath = `VinPoker/supabase/${directory}test.sql`;
    assert.equal(selectCashierSchemaMode([[{ filename: oldPath, status: 'removed' }]]), 'pre03');
    assert.equal(selectCashierSchemaMode([[{ filename: 'src/ui.ts' }], [{ filename: 'elsewhere.sql', previous_filename: oldPath, status: 'renamed' }]]), 'pre03');
  }
  assert.equal(selectCashierSchemaMode([[{ filename: 'VinPoker/src/ui.ts' }]]), 'current');
});

test('unverifiable PR file input fails closed', () => {
  for (const input of [null, [], [[]], [{ filename: 'x' }], [[{}]], [[{ filename: 'x', previous_filename: 7 }]]]) {
    assert.throws(() => selectCashierSchemaMode(input));
  }
  assert.throws(() => selectCashierSchemaMode([Array.from({ length: 3000 }, (_, index) => ({ filename: `src/${index}.ts` }))]), /API cap reached/);
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

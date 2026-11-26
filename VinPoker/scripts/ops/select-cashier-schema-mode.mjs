import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const policyPath = 'VinPoker/scripts/ops/cashier-hud35-qualified-scope.json';
const selectorPath = 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs';
const receiptPath = 'VinPoker/scripts/ops/fixtures/cashier-ci-hud35-qualified-receipt-20261107.json';
const sourcePackagePolicy = 'VinPoker/scripts/ops/cashier-source342-344-qualified-scope.json';
const sourcePackageReceipt = 'VinPoker/scripts/ops/fixtures/cashier-source342-344-runtime-receipt.json';
const financePolicyPath = 'VinPoker/scripts/ops/finance-source-qualified-scope-20261126.json';
const financeReceiptPath = 'VinPoker/scripts/ops/fixtures/finance-source-runtime-receipt-20261126.json';
const financePolicyOwnedPaths = [
  '.github/workflows/cashier-tour-real-e2e.yml',
  'VinPoker/e2e/cashier-tour-real.spec.ts',
  'VinPoker/scripts/ops/select-cashier-schema-mode.mjs',
  'VinPoker/scripts/ops/cashier-schema-mode.test.mjs',
  'VinPoker/scripts/ops/finance-schema-policy.test.mjs',financePolicyPath,financeReceiptPath,
  'VinPoker/docs/superpowers/plans/2026-11-26-finance-schema-ci-policy.md',
].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalHash = bytes => hash(bytes.toString('utf8').replace(/\r\n?/g, '\n'));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

// Only committed tree objects are evidence. Never read PR worktree policy/SQL.
function gitReader(repo) {
  return (...args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 16 * 1024 * 1024 });
}

function verifyTreeDiff(files, { repo, base, head }) {
  assert.ok(sha(base) && sha(head), 'Exact base/head commit SHAs required');
  const git = gitReader(repo);
  const diffBase = git('merge-base', base, head).toString().trim();
  assert.ok(sha(diffBase), 'Merge base required');
  const delta = git('diff', '--no-renames', '--name-status', '-z', diffBase, head).toString().split('\0');
  delta.pop();
  assert.equal(delta.length % 2, 0, 'Malformed tree diff');
  const statuses = { A: 'added', M: 'modified', D: 'removed' };
  const actual = [];
  for (let i = 0; i < delta.length; i += 2) {
    assert.ok(statuses[delta[i]], 'Unsupported tree change');
    actual.push([delta[i + 1], statuses[delta[i]]]);
  }
  assert.deepEqual(files.map(f => [f.filename, f.status]).sort(), actual.sort(), 'PR pages do not match exact base/head tree diff');
  return { git, diffBase };
}

export function qualifiedHud35(files, { repo, base, head }) {
  const { git, diffBase } = verifyTreeDiff(files, { repo, base, head });
  const trees = new Map();
  const blob = (revision, path) => {
    if (!trees.has(revision)) {
      const entries = git('ls-tree', '-r', '-z', revision).toString().split('\0').filter(Boolean);
      trees.set(revision, new Map(entries.map(entry => {
        const tab = entry.indexOf('\t');
        return [entry.slice(tab + 1), entry.slice(0, tab)];
      })));
    }
    assert.match(trees.get(revision).get(path) || '', /^100644 blob [a-f0-9]{40}$/, `Regular tracked file required: ${path}`);
    return git('show', `${revision}:${path}`);
  };

  // A PR cannot edit its own exemption or executable validator.
  for (const path of [policyPath, receiptPath, selectorPath]) {
    assert.deepEqual(blob(head, path), blob(base, path), `PR changes trusted guard: ${path}`);
  }
  const policy = JSON.parse(blob(base, policyPath));
  const workflowPath = '.github/workflows/cashier-tour-real-e2e.yml';
  assert.equal(policy.integratedWorkflow.path, workflowPath);
  const workflowHash = canonicalHash(blob(head, workflowPath));
  assert.ok(workflowHash === canonicalHash(blob(base, workflowPath)) || workflowHash === policy.integratedWorkflow.sha256,
    'PR changes trusted guard: workflow must match base or exact reviewed integration');
  assert.equal(policy.runtimeInputs.candidateSha, '26d829241c1da649eae4ec37aaff398ab00a5173');
  assert.equal(policy.runtimeInputs.kind, 'REVIEWED_INPUT_PINS_RUNTIME_STILL_REQUIRED');
  assert.ok(policy.runtimeFiles.length > 0, 'Qualified runtime inputs required');
  for (const file of policy.runtimeFiles) {
    assert.equal(canonicalHash(blob(head, file.path)), file.sha256, `Runtime guard drift: ${file.path}`);
  }
  const proof = policy.proof;
  assert.equal(policy.schemaVersion, 1);
  assert.equal(proof.receiptPath, receiptPath);
  assert.equal(proof.receiptSha256, '4105af2d4f69021ed632227f33719985045508371bef302041334e642904e145');
  assert.equal(proof.run, 42390747260);
  assert.equal(proof.attempt, 1);
  assert.equal(proof.repository, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(proof.workflowId, 410345048);
  assert.equal(proof.orchestrationSha, 'ea3844085ecfd34b7b21ba19160317e57db4637d');
  assert.equal(proof.actor, 'PhamGiaVinh');
  assert.equal(proof.event, 'workflow_dispatch');
  assert.equal(proof.branch, 'main');
  assert.equal(proof.conclusion, 'success');
  assert.equal(proof.artifact.id, 13581521958);
  assert.equal(proof.artifact.sha256, 'cef4f896950da8e7f32ed14e5aaee930352926a00e212d80ea2674ea89aaee8e');
  const receiptBytes = blob(base, receiptPath);
  assert.equal(hash(receiptBytes), proof.receiptSha256, 'Qualification receipt checksum mismatch');
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.candidateSha, policy.scope.candidateSha);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.complete, true);
  assert.equal(receipt.stage, 'complete');
  assert.equal(receipt.backfill.failed, 0);
  assert.equal(receipt.shadow.passed, true);
  assert.equal(receipt.shadow.mismatches, 0);
  const sql = policy.scope.newSqlFiles;
  assert.equal(sql.length, 35);
  assert.equal(new Set(sql.map(f => f.path)).size, 35);
  assert.deepEqual(receipt.committed, sql.map(f => ({ version: f.version, sha256: f.sha256 })));
  const catalog = policy.scope.catalogMetadata;
  const expected = new Map([...sql, catalog].map(f => [f.path, f.status]));
  const migrationFiles = files.filter(f => isMigrationPath(f.filename) || isMigrationPath(f.previous_filename));
  assert.equal(migrationFiles.length, expected.size, 'Complete qualified package required');
  for (const file of migrationFiles) {
    assert.equal(file.previous_filename, undefined, 'Renames cannot qualify');
    assert.equal(file.status, expected.get(file.filename), 'Unknown migration or changed status');
  }
  for (const file of sql) {
    assert.equal(git('ls-tree', diffBase, '--', file.path).length, 0, 'Qualified SQL must be new');
    assert.equal(canonicalHash(blob(head, file.path)), file.sha256, `SQL drift: ${file.path}`);
  }
  assert.equal(canonicalHash(blob(diffBase, catalog.path)), catalog.baseSha256, 'Catalog preimage drift');
  assert.equal(canonicalHash(blob(head, catalog.path)), catalog.headSha256, 'Catalog postimage drift');
  return true;
}

const prefixes = ['VinPoker/supabase/migrations/', 'VinPoker/supabase/migration-archive/', 'VinPoker/supabase/pending-migrations/'];
const isMigrationPath = path => typeof path === 'string' && prefixes.some(prefix => path.startsWith(prefix));

export function qualifiedSource342(files, context) {
  const { diffBase } = verifyTreeDiff(files, context);
  // This bounded manifest contains source files, not database dumps. Avoid
  // allocating the historical reader's 16MiB buffer for every pinned blob.
  const git = (...args) => execFileSync('git', ['-C', context.repo, ...args], { maxBuffer: 2 * 1024 * 1024 });
  const { base, head } = context;
  const blob = (revision, path) => {
    const entry = git('ls-tree', revision, '--', path).toString();
    assert.match(entry, /^100644 blob [a-f0-9]{40}\t/, `Regular tracked file required: ${path}`);
    return git('show', `${revision}:${path}`);
  };
  for (const path of [sourcePackagePolicy, sourcePackageReceipt, policyPath, receiptPath, selectorPath,
    'VinPoker/scripts/ops/cashier-source-package-evidence.mjs',
    'VinPoker/scripts/ops/cashier-source-package.test.mjs',
    '.github/workflows/cashier-tour-real-e2e.yml']) {
    assert.ok(blob(head, path).equals(blob(base, path)), `PR changes trusted guard: ${path}`);
  }
  const policy = JSON.parse(blob(base, sourcePackagePolicy));
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.kind, 'EXACT_SOURCE342_344_CURRENT_RUNTIME_EXCEPTION');
  const proof = policy.proof;
  assert.equal(proof.run, 43383314661);
  assert.equal(proof.sourceSha, 'bea2c224a87722d7fa674d835224c304bc6bc757');
  assert.equal(proof.workflowId, 360553822);
  assert.equal(proof.actor, 'PhamGiaVinh');
  assert.equal(proof.event, 'workflow_dispatch');
  assert.equal(proof.conclusion, 'success');
  assert.equal(proof.artifact.id, 14018845047);
  assert.equal(proof.artifact.sha256, '075cc1341c72942d885e3935e0a74091505d41e114c52752f85dfb69b97a8ed7');
  assert.equal(proof.receiptPath, sourcePackageReceipt);
  assert.equal(proof.receiptSha256, '0c4fe1f61d65d3b759e18f6b240de4a4fa8359124e649da9465d0edbb3fa1635');
  assert.equal(canonicalHash(blob(base, sourcePackageReceipt)), proof.receiptSha256);
  const receipt = JSON.parse(blob(base, sourcePackageReceipt));
  for (const key of ['run', 'sourceSha', 'workflowId', 'actor', 'event', 'conclusion', 'artifact']) {
    assert.deepEqual(receipt[key], proof[key], `Evidence mismatch: ${key}`);
  }
  const migrations = files.filter(f => isMigrationPath(f.filename) || isMigrationPath(f.previous_filename));
  assert.equal(policy.migrationScope.length, 4);
  assert.equal(new Set(policy.migrationScope.map(f => f.path)).size, 4);
  assert.equal(migrations.length, 4, 'Complete exact source package required');
  const status = { A: 'added', M: 'modified' };
  for (const expected of policy.migrationScope) {
    const actual = migrations.find(f => f.filename === expected.path);
    assert.ok(actual && actual.previous_filename === undefined, 'Exact package path required');
    assert.equal(actual.status, status[expected.status]);
    assert.equal(canonicalHash(blob(head, expected.path)), expected.headSha256, 'SQL/catalog drift');
    if (expected.status === 'A') {
      assert.equal(git('ls-tree', diffBase, '--', expected.path).length, 0, 'SQL must be new');
    } else {
      assert.equal(expected.status, 'M');
      assert.equal(canonicalHash(blob(diffBase, expected.path)), expected.baseSha256, 'Catalog preimage drift');
    }
  }
  assert.ok(policy.runtimeFiles.length > 0, 'Runtime pins required');
  for (const file of policy.runtimeFiles) {
    assert.equal(canonicalHash(blob(head, file.path)), file.sha256, `Runtime guard drift: ${file.path}`);
  }
  return true;
}

export function qualifiedFinanceSources(files, context) {
  const {git,diffBase}=verifyTreeDiff(files,context),{base,head}=context;
  const blob=(revision,path)=>{
    assert.match(git('ls-tree',revision,'--',path).toString(),/^100644 blob [a-f0-9]{40}\t/,`Regular tracked file required: ${path}`);
    return git('show',`${revision}:${path}`);
  };
  // This is a proposed policy until it is reviewed and merged into the trusted
  // base. A product PR cannot introduce or alter its own admission authority.
  for(const path of [financePolicyPath,financeReceiptPath,selectorPath,policyPath,receiptPath,
    sourcePackagePolicy,sourcePackageReceipt,'.github/workflows/cashier-tour-real-e2e.yml',
    'VinPoker/scripts/ops/finance-schema-policy.test.mjs','VinPoker/scripts/ops/cashier-schema-mode.test.mjs',
    'VinPoker/e2e/cashier-tour-real.spec.ts']) {
    assert.ok(blob(head,path).equals(blob(base,path)),`PR changes trusted guard: ${path}`);
  }
  const policy=JSON.parse(blob(base,financePolicyPath));
  assert.equal(policy.schemaVersion,1);
  assert.equal(policy.kind,'EXACT_FINANCE_NEW_SOURCE_CURRENT_RUNTIME_EXCEPTION');
  assert.equal(policy.sourceCandidate,'e231ba934bbbc7e0608499dc05bb306f1f51f544');
  const receiptHash='5e8ab4e6e9646b31fbe3dca9e9d190b6e5ff9ffabaedb6c3fbed636d216183d0';
  assert.equal(policy.proof.receiptPath,financeReceiptPath);
  assert.equal(policy.proof.receiptSha256,receiptHash);
  assert.equal(canonicalHash(blob(base,financeReceiptPath)),receiptHash,'Finance receipt drift');
  const receipt=JSON.parse(blob(base,financeReceiptPath));
  const producer={run:45743719060,workflowId:431098994,sourceSha:policy.sourceCandidate,actor:'PhamGiaVinh',
    event:'pull_request',path:'.github/workflows/finance-expense-cash-client.yml',conclusion:'success',attempt:1};
  assert.deepEqual(receipt.producer,producer);
  for(const [key,value] of Object.entries(producer))assert.equal(policy.proof[key],value,`Finance proof drift: ${key}`);
  assert.deepEqual(policy.migrationScope,receipt.scope);
  assert.deepEqual(policy.runtimePins,receipt.runtimePins);
  // Delta equality alone misses dependencies inherited from a newer BASE.
  // Bind the entire application/CI tree to the actual native producer, with
  // only this separately reviewed policy/harness package's eight files excluded.
  assert.deepEqual(policy.productTree,receipt.productTree);
  assert.deepEqual(policy.productTree.prefixes,['.github/','VinPoker/']);
  assert.deepEqual(policy.productTree.excluded,financePolicyOwnedPaths);
  assert.equal(policy.productTree.kind,'COMMITTED_PRODUCT_TREE_BOUND_TO_PRODUCER_SOURCE');
  const productEntries=git('ls-tree','-r','-z',head).toString().split('\0').filter(Boolean).filter(entry=>{
    const path=entry.slice(entry.indexOf('\t')+1);
    return (path.startsWith('VinPoker/')||path.startsWith('.github/'))&&!financePolicyOwnedPaths.includes(path);
  }).sort();
  assert.equal(productEntries.length,policy.productTree.entries,'Inherited product tree changed');
  assert.equal(hash(Buffer.from(productEntries.join('\0')+'\0')),policy.productTree.sha256,'Inherited runtime dependency drift');
  const admittedPaths=[...policy.migrationScope,...policy.runtimePins].map(f=>f.path).sort();
  assert.equal(admittedPaths.length,41);assert.equal(new Set(admittedPaths).size,41);
  assert.deepEqual(files.map(f=>f.filename).sort(),admittedPaths,'Unlisted change invalidates exact finance evidence');
  assert.ok(files.every(f=>f.previous_filename===undefined),'Finance package cannot rename any path');
  const expectedPaths=[
    ['VinPoker/supabase/migration-archive/floor-v3-catalog-reconciliation.manifest.json','M'],
    ['VinPoker/supabase/migrations/20270128000354_finance_expense_scope_idempotency.sql','A'],
    ['VinPoker/supabase/pending-migrations/20261126001901_finance_pt_cash_drawer_link_v1.sql','A'],
    ['VinPoker/supabase/pending-migrations/20261126011530_finance_expense_cash_source_v1.sql','A'],
    ['VinPoker/supabase/pending-migrations/20261126023026_finance_expense_cash_source_status_v1.sql','A'],
  ];
  assert.deepEqual(policy.migrationScope.map(f=>[f.path,f.status]).sort(),expectedPaths.sort());
  const migrations=files.filter(f=>isMigrationPath(f.filename)||isMigrationPath(f.previous_filename));
  assert.equal(migrations.length,5,'Complete exact finance source package required');
  for(const expected of policy.migrationScope){
    const actual=migrations.find(f=>f.filename===expected.path);
    assert.ok(actual&&actual.previous_filename===undefined,'Exact finance path required');
    assert.equal(actual.status,expected.status==='A'?'added':'modified');
    assert.equal(canonicalHash(blob(head,expected.path)),expected.headSha256,'Finance SQL/catalog drift');
    if(expected.status==='A')assert.equal(git('ls-tree',diffBase,'--',expected.path).length,0,'Finance SQL must be new');
    else assert.equal(canonicalHash(blob(diffBase,expected.path)),expected.baseSha256,'Finance catalog preimage drift');
  }
  assert.equal(policy.runtimePins.length,36,'Complete reviewed finance inputs required');
  assert.equal(new Set(policy.runtimePins.map(f=>f.path)).size,36);
  for(const file of policy.runtimePins)assert.equal(canonicalHash(blob(head,file.path)),file.sha256,`Finance runtime drift: ${file.path}`);
  assert.equal(receipt.observed.actualPostgrest,true);
  assert.equal(receipt.observed.freshCases,19);assert.equal(receipt.observed.reusedCases,1);
  assert.equal(receipt.observed.reusedProducerConclusion,'failure');
  assert.equal(receipt.observed.productionMutation,false);assert.equal(receipt.observed.productionCapacityClaim,false);
  // Admission only chooses contemporary Cashier compatibility tests. It does
  // not claim historical 03/11 upgrade proof, native-load or release approval.
  return true;
}

export function selectCashierSchemaMode(pages, context) {
  assert.ok(Array.isArray(pages) && pages.length > 0, 'PR file pages required');
  assert.ok(pages.every(Array.isArray), 'PR file pages malformed');
  const files = pages.flat();
  assert.ok(files.length > 0, 'PR files required');
  // GitHub caps PR-files responses at 3000; completeness is unproven at the cap.
  assert.ok(files.length < 3000, 'PR files API cap reached; historical proof required');
  const seen = new Set();
  let historical = false;
  for (const file of files) {
    assert.ok(file && typeof file.filename === 'string' && file.filename.length > 0, 'PR filename required');
    assert.ok(file.previous_filename === undefined || typeof file.previous_filename === 'string', 'PR previous filename malformed');
    assert.ok(!seen.has(file.filename), 'Duplicate PR path');
    seen.add(file.filename);
    for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
      if (prefixes.some(prefix => path.startsWith(prefix))) historical = true;
    }
  }
  // Even an apparently UI-only API response must match the pinned commits.
  // A stale response cannot hide a migration in the actual head.
  if (context) verifyTreeDiff(files, context);
  if (historical && context) {
    try { if (qualifiedFinanceSources(files, context)) return 'current'; }
    catch (error) { console.error(`Exact finance source package rejected: ${error.message}`); }
    if (process.env.PR_NUMBER === '1730' && process.env.GITHUB_REPOSITORY === 'PhamGiaVinh/abcxyzrandomsarghes') {
      const reviewed = '47bf50e95126b6b25e94b0075efb3274a13d5e96';
      const git = gitReader(context.repo);
      const rawDiff = (from, to) => git('diff', '--no-renames', '--raw', '--no-abbrev', '-z', from, to);
      const ancestor = git('merge-base', context.base, context.head).toString().trim();
      // Require every path, mode and before/after blob of the reviewed change.
      // Update the product branch after this policy lands to inherit the trusted runner.
      if (ancestor === context.base &&
          rawDiff(ancestor, context.head).equals(rawDiff(reviewed + '^', reviewed))) {
        return 'current-cashier1730';
      }
    }
    try { if (qualifiedSource342(files, context)) return 'current-source342'; }
    catch (error) { console.error(`Exact source342 package rejected: ${error.message}`); }
    // Rejection preserves the original historical requirement, never a PASS.
    try { if (qualifiedHud35(files, context)) return 'current'; }
    catch (error) { console.error(`Qualified HUD35 rejected; historical proof required: ${error.message}`); }
  }
  return historical ? 'pre03' : 'current';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, base, head] = process.argv.slice(2);
  console.log(selectCashierSchemaMode(JSON.parse(readFileSync(0, 'utf8')), repo ? { repo, base, head } : undefined));
}

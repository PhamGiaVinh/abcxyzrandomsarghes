import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const policyPath = 'VinPoker/scripts/ops/cashier-hud35-qualified-scope.json';
const selectorPath = 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs';
const receiptPath = 'VinPoker/scripts/ops/fixtures/cashier-ci-hud35-qualified-receipt-20261107.json';
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

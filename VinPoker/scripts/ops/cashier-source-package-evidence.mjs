import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const policyBootstrapFiles = [
  ['.github/workflows/cashier-tour-real-e2e.yml', 'M'],
  ['VinPoker/scripts/ops/cashier-schema-mode.test.mjs', 'M'],
  ['VinPoker/scripts/ops/select-cashier-schema-mode.mjs', 'M'],
  ['VinPoker/scripts/ops/cashier-source-package-evidence.mjs', 'A'],
  ['VinPoker/scripts/ops/cashier-source-package.test.mjs', 'A'],
  ['VinPoker/scripts/ops/cashier-source342-344-qualified-scope.json', 'A'],
  ['VinPoker/scripts/ops/fixtures/cashier-source342-344-runtime-receipt.json', 'A'],
];

export function validatePolicyBootstrapScope(files, { repository, number, mode, sourcePackage }) {
  assert.equal(repository, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(String(number), '1635', 'Only the policy-only PR may use the pinned integration fixture');
  assert.equal(mode, 'current', 'Protected-base historical selection cannot be overridden');
  assert.equal(sourcePackage, 'none', 'Admitted packages must run their own source');
  assert.deepEqual(files.map(f => [...f]).sort(), policyBootstrapFiles.map(f => [...f]).sort(),
    'Complete policy-only diff required; no product/source SQL changes');
  return true;
}

const expected = JSON.parse(readFileSync(new URL('./fixtures/cashier-source342-344-runtime-receipt.json', import.meta.url)));
export function validateSourcePackageEvidence(read) {
  for (const row of expected.receipts) {
    const actual = read(row.file);
    for (const [key, value] of Object.entries(row.receipt)) {
      assert.deepEqual(actual[key], value, `${row.file}: ${key}`);
    }
  }
  const audience = read('operations-audience-http.json');
  assert.equal(audience.workloadModel, 'selected-table', 'Scoped-detail evidence requires the selected-table profile');
  assert.equal(audience.phase, 'passed');
  assert.equal(audience.productionChanged, false);
  assert.equal(audience.sourceBatchModeVerified, true);
  assert.ok(audience.servingSourceBatchRpcCalls > 0, 'Batch RPC must actually serve viewers');
  for (const key of ['zeroErrors', 'atLeast30Seconds', 'allViewers', 'sourceBatchModeAndServingUsage',
    'allSawLaterTableRevision', 'tableP95Within3Seconds', 'markerToScopedDetailP95Within3Seconds',
    'tableSpecificSourceDeliveryVerified', 'publicationMaxWithin5Seconds']) {
    assert.equal(audience.checks?.[key], true, `Missing/failed audience check: ${key}`);
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--bootstrap-scope') {
    const [repository, number, mode, sourcePackage, base, head] = process.argv.slice(3);
    assert.match(base || '', /^[a-f0-9]{40}$/);
    assert.match(head || '', /^[a-f0-9]{40}$/);
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 });
    const mergeBase = git('merge-base', base, head).trim();
    const fields = git('diff', '--no-renames', '--name-status', '-z', mergeBase, head).split('\0');
    assert.equal(fields.pop(), '');
    assert.equal(fields.length % 2, 0);
    const files = [];
    for (let i = 0; i < fields.length; i += 2) files.push([fields[i + 1], fields[i]]);
    validatePolicyBootstrapScope(files, { repository, number, mode, sourcePackage });
    console.log('Exact policy-only integration fixture permitted; source identity must remain explicit');
  } else {
    const directory = process.argv[2];
    assert.ok(directory, 'Actual runtime evidence directory required');
    validateSourcePackageEvidence(name => JSON.parse(readFileSync(resolve(directory, name))));
    console.log('Exact source342–344 runtime evidence verified; not historical or scale qualification');
  }
}

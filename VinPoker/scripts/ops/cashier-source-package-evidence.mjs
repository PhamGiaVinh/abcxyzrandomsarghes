import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expected = JSON.parse(readFileSync(new URL('./fixtures/cashier-source342-344-runtime-receipt.json', import.meta.url)));
export function validateSourcePackageEvidence(read) {
  for (const row of expected.receipts) {
    const actual = read(row.file);
    for (const [key, value] of Object.entries(row.receipt)) {
      assert.deepEqual(actual[key], value, `${row.file}: ${key}`);
    }
  }
  const audience = read('operations-audience-http.json');
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
  const directory = process.argv[2];
  assert.ok(directory, 'Actual runtime evidence directory required');
  validateSourcePackageEvidence(name => JSON.parse(readFileSync(resolve(directory, name))));
  console.log('Exact source342–344 runtime evidence verified; not historical or scale qualification');
}

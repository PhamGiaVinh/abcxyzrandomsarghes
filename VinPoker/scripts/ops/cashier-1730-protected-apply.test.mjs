import assert from 'node:assert/strict';
import test from 'node:test';
import { apply1730, prepare1730 } from './cashier-1730-protected-apply.mjs';

const pre = {
  database: 'postgres', actor: 'postgres', ledgerCount: 0,
  fenceHash: '442f372d4edb76d720a21cbcd000266d',
  verifier: true, legacyChecks: 2, drawerFunction: null,
  columnPresent: false, indexPresent: false, triggerPresent: false,
};
const post = {
  ledgerCount: 1, columnPresent: true, indexValid: true, triggerEnabled: true,
  fenceHash: '1da6ba42509a0677f12276345d4ea36d',
  drawerFunction: 'a3b81f02c6afbcaedeb0075551c2dff6',
  shiftSummary: '1e782ef7572000335d88f2982b0a6a28',
  rangeSummary: '6e50425deb32527e1784a56ecc88307e',
};
const exactReceipt = { count: 1, exact: true };

test('constructs exact migration and receipt wrapper', () => {
  const atomic = prepare1730(process.env.RELEASE_SOURCE_ROOT);
  assert.match(atomic, /INSERT INTO supabase_migrations\.schema_migrations/);
});

test('stops before writing on catalog drift', () => {
  assert.throws(() => apply1730('atomic', {
    json: () => ({ ...pre, triggerPresent: true }),
    execute: () => assert.fail('unexpected production write'),
  }, () => {}), /preflight differs/);
});

test('verifies catalog and ledger after sending the migration once', () => {
  const responses = [pre, exactReceipt, post];
  const writes = [];
  const reports = [];
  apply1730('atomic', { json: () => responses.shift(), execute: sql => writes.push(sql) },
    event => reports.push(event));
  assert.deepEqual(writes, ['atomic']);
  assert.deepEqual(reports, ['CASHIER1730_COMMITTED_EXACT_AND_POSTCHECK_PASS']);
  assert.deepEqual(responses, []);
});

test('ambiguous response checks the receipt and stops without replay', () => {
  const responses = [pre, exactReceipt];
  let attempts = 0;
  const reports = [];
  assert.throws(() => apply1730('atomic', {
    json: () => responses.shift(),
    execute: () => { attempts++; throw new Error('timeout'); },
  }, event => reports.push(event)), /requires review/);
  assert.equal(attempts, 1);
  assert.deepEqual(reports, ['CASHIER1730_STOP receipt=committed-exact']);
});

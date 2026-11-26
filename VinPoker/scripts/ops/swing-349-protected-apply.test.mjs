import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply349, prepare349 } from './swing-349-protected-apply.mjs';

const pre = { database: 'postgres', actor: 'postgres', ledgerCount: 0, definitions: true, metadata: [[11]] };
const exact = { count: 1, exact: true };
const post = { ...pre, ledgerCount: 1 };

test('SWING349 issues one atomic write and verifies ledger and metadata', () => {
  const source = prepare349(process.env.RELEASE_SOURCE_ROOT);
  const responses = [pre, exact, post];
  let writes = 0;
  const messages = [];
  apply349(source, {
    json: () => responses.shift(),
    execute: sql => { assert.equal(sql, source); writes++; },
  }, message => messages.push(message));
  assert.equal(writes, 1);
  assert.deepEqual(responses, []);
  assert.deepEqual(messages, ['SWING349_COMMITTED_EXACT_AND_POSTCHECK_PASS']);
});

test('SWING349 refuses drift before writing', () => {
  for (const value of [{ ...pre, definitions: false }, { ...pre, ledgerCount: 1 }, { ...pre, metadata: [] }]) {
    assert.throws(() => apply349('', {
      json: () => value,
      execute: () => assert.fail('unexpected write'),
    }, () => {}), /preflight/);
  }
});

test('SWING349 never retries after a lost response and reports the exact commit', () => {
  let writes = 0;
  const responses = [pre, exact];
  const messages = [];
  assert.throws(() => apply349('', {
    json: () => responses.shift(),
    execute: () => { writes++; throw new Error('lost response'); },
  }, message => messages.push(message)), /requires review/);
  assert.equal(writes, 1);
  assert.deepEqual(messages, ['SWING349_STOP receipt=committed-exact']);
});

test('SWING349 rejects metadata drift after commit', () => {
  const responses = [pre, exact, { ...post, metadata: [[11], [13]] }];
  assert.throws(() => apply349('', {
    json: () => responses.shift(), execute: () => {},
  }, () => assert.fail('unexpected success')), /metadata differs/);
});

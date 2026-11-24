import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyPhase, catalogSql, preparePackage, releaseSha } from './tracker-bb-ante-release.mjs';

const root = process.env.RELEASE_SOURCE_ROOT ?? fileURLToPath(new URL('../..', import.meta.url));
const pre = { database: 'postgres', actor: 'postgres', pending: true, definitions: true, objects: true, metadata: Array.from({length:4}, (_, i) => ['retained', i, null]) };
const post = { ...pre };
const exact = { count: 1, exact: true };

test('pins the observed production reader and retains its plan-cache wrapper', () => {
  const phases=preparePackage(root);
  assert.match(catalogSql(phases[0]),/eae66e8c287d78489e8facea7303f7b9/);
  assert.match(catalogSql(phases[1],true),/f72e77c775b7b195dad149284f542533/);
});

test('prepares only the two reviewed migrations and pins the consumer source', () => {
  const phases = preparePackage(root);
  assert.equal(releaseSha, '3c6e2080a0afd2f611693ff13b280d368df886a3');
  assert.deepEqual(phases.map(p => p.version), ['20270128000350', '20270128000351']);
  for (const phase of phases) {
    assert.match(phase.atomic, /pg_advisory_xact_lock/);
    assert.match(phase.atomic, /INSERT INTO supabase_migrations.schema_migrations/);
  }
});

test('each phase performs one write and verifies the exact receipt and preserved metadata', () => {
  for (const phase of preparePackage(root)) {
    const responses = [pre, ...(phase.version.endsWith('351') ? [exact] : []), exact, post];
    let writes = 0;
    applyPhase(phase, { json: () => responses.shift(), execute: sql => { assert.equal(sql, phase.atomic); writes++; } });
    assert.equal(writes, 1);
    assert.deepEqual(responses, []);
  }
});

test('refuses a partial package or function drift before any write', () => {
  for (const changed of [{ pending: false }, { definitions: false }, { objects: false }, { metadata: [] }, { database: 'other' }]) {
    assert.throws(() => applyPhase(preparePackage(root)[0], {
      json: () => ({ ...pre, ...changed }), execute: () => assert.fail('unexpected write'),
    }), /preflight/);
  }
});

test('lost response is classified without retrying the writer or the next phase', () => {
  const responses = [pre, exact];
  let writes = 0;
  const messages = [];
  assert.throws(() => applyPhase(preparePackage(root)[0], {
    json: () => responses.shift(), execute: () => { writes++; throw Error('lost'); },
  }, message => messages.push(message)), /requires review/);
  assert.equal(writes, 1);
  assert.deepEqual(messages, ['TRACKER_BBA_STOP 20270128000350 receipt=committed-exact']);
});

test('a bad receipt or changed function privileges cannot produce success', () => {
  for (const responses of [[pre, exact, { count: 1, exact: false }], [pre, exact, exact, { ...post, metadata: [['changed']] }]]) {
    assert.throws(() => applyPhase(preparePackage(root)[1], {
      json: () => responses.shift(), execute: () => {},
    }, () => assert.fail('unexpected success')), /receipt|metadata/);
  }
});

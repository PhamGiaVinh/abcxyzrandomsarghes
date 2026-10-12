import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMigration, atomicSql, preflightSql, classifyPreflight, executePackage } from './dealer-stop-64-release-plan.mjs';
import { scanMigrationSource } from './ops-1359-release-gate.mjs';
const good = { database: 'postgres', actor: 'postgres', existing: 0, baseline: true, new_rpc_absent: true, namespace_absent: true };
test('exact64 pins SQL and records it before its only transaction commit', () => {
  const item = loadMigration(), sql = atomicSql();
  assert.equal(item.version, '20270128000064');
  assert.equal(scanMigrationSource(sql).mode, 'outer-transaction');
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations') < sql.lastIndexOf('COMMIT;'));
  for (const key of ['version', 'name', 'filename', 'hash', 'sql']) assert.throws(() => atomicSql({ ...item, [key]: item[key] + 'drift' }));
  assert.match(preflightSql(), /floor_table_v3_lock_receipt/);
});
test('exact64 denies changed dependencies, schema, actor, namespace or ledger', () => {
  assert.doesNotThrow(() => classifyPreflight(good));
  for (const delta of [{ database: 'other' }, { actor: 'other' }, { existing: 1 }, { baseline: false }, { new_rpc_absent: false }, { namespace_absent: false }]) assert.throws(() => classifyPreflight({ ...good, ...delta }));
});
test('unknown commit outcome observes receipt once without retry', () => {
  let writes = 0, reads = 0;
  const reports = [];
  assert.throws(() => executePackage({ json: () => ++reads === 1 ? good : { count: 1, exact: true },
    execute: () => { writes++; throw Error('lost response'); } }, x => reports.push(x)), /requires review/);
  assert.equal(writes, 1); assert.equal(reads, 2);
  assert.deepEqual(reports, ['STOP64 receipt=committed-exact; no retry']);
});
test('success requires exact receipt and object check', () => {
  let writes = 0;
  executePackage({ json: q => q.includes('current_database()') ? good : { count: 1, exact: true }, execute: () => writes++ });
  assert.equal(writes, 2);
  assert.throws(() => executePackage({ json: q => q.includes('current_database()') ? good : { count: 1, exact: true },
    execute: () => { throw Error('no postcheck success'); } }));
});

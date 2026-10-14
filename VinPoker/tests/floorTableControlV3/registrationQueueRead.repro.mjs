import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/components/cashier/tournament-live/RegistrationQueuePanel.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const load = useCallback(');
const end = source.indexOf('  // initial + realtime', start);
assert.ok(start >= 0 && end > start);
const body = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(failedTable, deferred) {
  const published = [], errors = [];
  const responses = {
    tournament_registrations: { data: [{ id: 'reg', status: 'confirmed', player_id: 'player', confirmed_by: null }], error: null },
    tournament_entries: { data: [{ id: 'entry', registration_id: 'reg', status: 'seated', current_stack: 20000 }], error: null },
    seat_draw_receipts: { data: [{ registration_id: 'reg', status: 'issued', receipt_code: 'ticket' }], error: null },
    profiles: { data: [], error: null },
  };
  if (failedTable) responses[failedTable] = { data: null, error: { message: `${failedTable}:503` } };
  const context = {
    tournamentId: 'tour', seqRef: { current: 0 }, setLoading() {},
    setRows: rows => published.push(rows), setLastRefreshed() {}, setReadError() {},
    toast: { error: message => errors.push(message) }, useCallback: fn => fn,
    supabase: { from: table => {
      const response = deferred && table === 'tournament_entries' ? deferred :
        failedTable === 'throw' && table === 'tournament_entries' ? Promise.reject(new TypeError('Failed to fetch')) : responses[table];
      const query = { then: (resolve, reject) => Promise.resolve(response).then(resolve, reject) };
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) query[method] = () => query;
      return query;
    } },
  };
  const load = new Function(...Object.keys(context), `${body}; return load;`)(...Object.values(context));
  return { load, published, errors, invalidate: () => { ++context.seqRef.current; } };
}

for (const table of ['tournament_registrations', 'tournament_entries', 'seat_draw_receipts', 'profiles']) {
  test(`failed ${table} read must not publish a verified queue`, async () => {
    const h = harness(table); await h.load();
    assert.equal(h.published.length, 0, 'partial read is not authoritative seating/receipt evidence');
    assert.equal(h.errors.length, 1);
  });
}
test('complete reads retain canonical seating and receipt', async () => {
  const h = harness(); await h.load();
  assert.equal(h.published[0][0].queueStatus, 'seated');
  assert.equal(h.published[0][0].entry_id, 'entry');
  assert.equal(h.published[0][0].receipt.receipt_code, 'ticket');
});
test('thrown fetch becomes an error, not a verified queue or uncaught rejection', async () => {
  const h = harness('throw'); await h.load();
  assert.equal(h.published.length, 0); assert.equal(h.errors.length, 1);
});
test('unmount/scope replacement fences a late successful read', async () => {
  let resolve;
  const h = harness(null, new Promise(done => { resolve = done; }));
  const pending = h.load(); h.invalidate();
  resolve({ data: [], error: null }); await pending;
  assert.equal(h.published.length, 0); assert.equal(h.errors.length, 0);
});

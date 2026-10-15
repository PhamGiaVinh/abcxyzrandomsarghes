import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { parseSync, transformSync } from '@swc/core';

// Executes the source callback with fake reads/state, without the full React graph.
// Not a replacement for the companion render tests, SDK transport or DB runtime.
const path = 'VinPoker/src/components/cashier/tournament-live/HandHistoryWorkspace.tsx';
const source = process.env.HISTORY_SOURCE_REVISION
  ? execFileSync('git', ['show', `${process.env.HISTORY_SOURCE_REVISION}:${path}`], { encoding: 'utf8' })
  : readFileSync(new URL('../../src/components/cashier/tournament-live/HandHistoryWorkspace.tsx', import.meta.url), 'utf8');
const tree = parseSync(source, { syntax: 'typescript', tsx: true });
let callback;
let tableEffect;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id.value === 'loadHands') callback = node.init.arguments[0].expression;
  if (node.type === 'CallExpression' && node.callee.value === 'useEffect') {
    const effect = node.arguments[0].expression;
    const text = Buffer.from(source).subarray(effect.span.start - tree.span.start, effect.span.end - tree.span.start).toString();
    if (text.includes('"list_tracker_tables_v2"')) tableEffect = effect;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(tree);
assert.ok(callback, 'actual loadHands callback must exist');
const expression = Buffer.from(source).subarray(callback.span.start - tree.span.start, callback.span.end - tree.span.start).toString();
const compiled = transformSync(`const callback = ${expression};`, {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
}).code + ';return callback;';
assert.ok(tableEffect, 'actual table-inventory effect must exist');
const tableCompiled = transformSync(`const effect = ${Buffer.from(source).subarray(tableEffect.span.start - tree.span.start, tableEffect.span.end - tree.span.start).toString()};`, {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
}).code + ';return effect;';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  let generation = 0;
  const state = { loading: false, error: null, selected: 'b', hands: [], queueError: false };
  const dependencies = {
    tournamentId: 'tour', selectedTableId: 'all', tables: [],
    loadGuardRef: { current: { begin: () => ++generation, isCurrent: request => request === generation, finish: () => {} } },
    setLoading: value => { state.loading = value; }, setLoadError: value => { state.error = value; },
    setHands: value => { state.hands = value; }, setCompletionStatusByHand: () => {},
    setCompletionStatusError: value => { state.queueError = value; },
    setSelectedHandId: update => { state.selected = update(state.selected); },
    FEATURES: { trackerHistoryCompletionWorker: true },
    handPlayersHasSnapshotForClient: async () => true,
    fetchHandPlayerDisplayForClient: async () => new Map(),
    chunkArray: items => [items], stringArray: value => Array.isArray(value) ? value : [],
    supabase: { rpc: async () => ({ data: [], error: null }) },
  };
  function load(id) {
    let page = 0;
    const pageAll = async () => ({ data: page++ === 0 ? [{ id, community_cards: [] }] : [], error: null });
    return Function(...Object.keys(dependencies), 'pageAll', compiled)(...Object.values(dependencies), pageAll)();
  }
  return { state, dependencies, load };
}

test('successful current read keeps its selected hand and finishes loading', async () => {
  const h = harness();
  await h.load('b');
  assert.equal(h.state.selected, 'b');
  assert.equal(h.state.hands[0].id, 'b');
  assert.equal(h.state.loading, false);
  assert.equal(h.state.error, null);
  assert.equal(h.state.queueError, false);
});

test('hand detail rejection becomes explicit error and releases loading', async () => {
  const h = harness();
  h.dependencies.handPlayersHasSnapshotForClient = async () => { throw new Error('read offline'); };
  await h.load('a');
  assert.equal(h.state.error, 'read offline');
  assert.equal(h.state.loading, false);
  assert.deepEqual(h.state.hands, []);
});
test('queue rejection preserves hand rows with unavailable status', async () => {
  const h = harness();
  h.dependencies.supabase.rpc = async () => { throw new Error('queue offline'); };
  await h.load('a');
  assert.equal(h.state.queueError, true);
  assert.equal(h.state.loading, false);
  assert.equal(h.state.hands[0].id, 'a');
});
test('late queue response cannot clear newer selection or finish its loading', async () => {
  const h = harness(), first = deferred(), second = deferred();
  let requests = 0;
  h.dependencies.supabase.rpc = () => ++requests === 1 ? first.promise : second.promise;
  const previous = h.load('a');
  for (let turn = 0; requests < 1 && turn < 30; turn++) await Promise.resolve();
  assert.equal(requests, 1);
  const current = h.load('b');
  for (let turn = 0; requests < 2 && turn < 30; turn++) await Promise.resolve();
  assert.equal(requests, 2);
  first.resolve({ data: [], error: null });
  await previous;
  assert.equal(h.state.selected, 'b');
  assert.equal(h.state.loading, true);
  second.resolve({ data: [], error: null });
  await current;
  assert.equal(h.state.selected, 'b');
  assert.equal(h.state.loading, false);
});

async function inventory(v2, legacy = { data: [], error: null }) {
  const state = { tables: [], error: null, loading: false, selected: 'physical' }, calls = [];
  const deps = {
    tournamentId: 'tour', supabase: { rpc: async name => { calls.push(name); return name === 'list_tracker_tables_v2' ? v2 : legacy; } },
    tableLoadGuardRef: { current: { begin: () => 1, finish: () => {}, invalidate: () => {} } },
    record: value => value && typeof value === 'object' && !Array.isArray(value) ? value : null,
    textValue: value => typeof value === 'string' && value.trim() ? value.trim() : null,
    setTables: value => { state.tables = typeof value === 'function' ? value(state.tables) : value; }, setTablesError: value => { state.error = value; },
    setTablesLoading: value => { state.loading = value; },
    setSelectedTableId: fn => { state.selected = fn(state.selected); },
  };
  const cleanup = Function(...Object.keys(deps), tableCompiled)(...Object.values(deps))();
  for (let turn = 0; turn < 15; turn++) await Promise.resolve();
  return { state, calls, cleanup };
}
test('canonical inventory maps exact logical and physical identities', async () => {
  const { state, calls } = await inventory({ data: { ok: true, tables: [{ tournament_table_id: 'logical', physical_table_id: 'physical', table_name: 'Table' }] }, error: null });
  assert.equal(state.tables[0].id, 'logical');
  assert.equal(state.selected, 'logical');
  assert.deepEqual(calls, ['list_tracker_tables_v2']);
});
for (const [name, response] of [
  ['authority denial', { data: { ok: false, error: 'actor_not_allowed' }, error: null }],
  ['transport failure', { data: null, error: { code: '503', message: 'Unavailable' } }],
  ['malformed success', { data: { ok: true, tables: null }, error: null }],
]) test(`inventory ${name} is not silently downgraded to legacy empty`, async () => {
  const { state, calls } = await inventory(response);
  assert.ok(state.error);
  assert.equal(state.loading, false);
  assert.deepEqual(calls, ['list_tracker_tables_v2']);
});
test('only absent canonical RPC falls back to the supported legacy contract', async () => {
  const { state, calls } = await inventory({ data: null, error: { code: 'PGRST202' } }, { data: [{ table_id: 'physical', table_name: 'Old table' }], error: null });
  assert.equal(state.tables[0].id, 'physical');
  assert.equal(state.error, null);
  assert.equal(calls.length, 2);
});
test('legacy read failure stays an error rather than successful empty inventory', async () => {
  const { state } = await inventory({ data: null, error: { code: '42883' } }, { data: null, error: { message: 'Legacy unavailable' } });
  assert.ok(state.error);
  assert.equal(state.loading, false);
});
test('rejected inventory promise is reported and releases its loading state', async () => {
  const { state, calls } = await inventory(Promise.reject(new Error('network rejected')));
  assert.equal(state.error, 'network rejected');
  assert.equal(state.loading, false);
  assert.deepEqual(calls, ['list_tracker_tables_v2']);
});
test('inventory completion after cleanup cannot repopulate the old scope', async () => {
  const read = deferred();
  const { state, cleanup } = await inventory(read.promise);
  cleanup();
  read.resolve({ data: { ok: true, tables: [{ tournament_table_id: 'old', table_name: 'Old' }] }, error: null });
  for (let turn = 0; turn < 15; turn++) await Promise.resolve();
  assert.deepEqual(state.tables, []);
  assert.equal(state.error, null);
  assert.equal(state.loading, true, 'old finally must not overwrite next scope loading');
});

test('History recovery tests are triggered and executed by the existing read-only workflow', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ops-v3-tracker-dealer.yml', import.meta.url), 'utf8');
  for (const path of ['VinPoker/src/components/cashier/tournament-live/HandHistoryWorkspace.tsx', 'VinPoker/tests/tracker/handHistoryReadRecovery*', 'VinPoker/src/components/cashier/tournament-live/handHistoryLoadGuard.ts', 'VinPoker/tests/tracker/handHistoryLoadGuard.test.ts']) {
    assert.ok(workflow.includes(`- "${path}"`), `trigger: ${path}`);
  }
  assert.ok(workflow.includes('          tests/tracker/handHistoryReadRecovery.test.tsx'));
  assert.ok(workflow.includes('          tests/tracker/handHistoryLoadGuard.test.ts'));
  assert.ok(workflow.includes('run: node tests/tracker/handHistoryReadRecovery.callback.test.mjs'));
});

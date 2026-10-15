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
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id.value === 'loadHands') callback = node.init.arguments[0].expression;
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
    loadGuardRef: { current: { begin: () => ++generation, isCurrent: request => request === generation } },
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

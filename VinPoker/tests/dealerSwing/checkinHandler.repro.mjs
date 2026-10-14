import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Execute the existing handler, not a duplicated desired implementation.
// This focused diagnostic does not replace component/browser acceptance.
const source = readFileSync(new URL('../../src/components/cashier/DealerSwingTab.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const doCheckin = async () => {');
const end = source.indexOf('  const doReCheckin =', start);
assert.ok(start >= 0 && end > start, 'actual check-in handler seam exists');
const body = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let generated = 0;
function harness(rpc, stored = new Map(), overrides = {}) {
  const effects = [];
  const scope = { current: 'actor:club' };
  const keys = { current: new Map() };
  const scopeStart = source.indexOf('  const checkinScope = useRef(');
  const scopeEnd = source.indexOf('  const loadCheckinDealers =', scopeStart);
  const scopeCode = ts.transpileModule(source.slice(scopeStart, scopeEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let unmount = () => {};
  const renderScope = new Function('useRef', 'useEffect', 'user', 'activeClubId', scopeCode);
  const changeScope = (actor, club) => renderScope(() => scope, effect => { unmount = effect() ?? (() => {}); }, { id: actor }, club);
  changeScope('actor', 'club');
  const context = {
    activeClubId: 'club', eligibleCheckinShifts: [{ id: 'shift' }], checkinShiftId: 'shift',
    checkinDealerIds: ['dealer'], processing: null, checkinScope: scope, checkinKeys: keys,
    checkinSubmission: { current: null },
    checkinCandidatesLoading: false, checkinCandidatesError: null,
    user: { id: 'actor' }, checkinDealers: [{ id: 'dealer', full_name: 'TEST', checkinStatus: 'new' }],
    dealerMassOpenRpc: rpc, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++generated).padStart(12, '0')}` },
    sessionStorage: { get length() { return stored.size; }, key: index => [...stored.keys()][index] ?? null,
      getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    setProcessing: value => effects.push(['processing', value]),
    setCheckinDealerIds: value => effects.push(['selection', value]),
    setCheckinOpen: value => effects.push(['open', value]),
    refetchDealers: () => effects.push(['refetch']), refetchCheckedOut: () => {},
    toast: { success: value => effects.push(['success', value]), warning: () => {} },
    ...overrides,
  };
  const run = new Function(...Object.keys(context), `${body}; return doCheckin;`)(...Object.values(context));
  return { run, effects, scope, keys, changeScope, unmount: () => unmount() };
}
for (const [label, overrides] of [
  ['loading', { checkinCandidatesLoading: true }],
  ['read failure', { checkinCandidatesError: 'READ_FAILED' }],
  ['current attendance', { checkinDealers: [{ id: 'dealer', checkinStatus: 'already_checked_in' }] }],
  ['ambiguous attendance', { checkinDealers: [{ id: 'dealer', checkinStatus: 'ambiguous' }] }],
]) {
  test(`unverified candidate ${label} cannot dispatch or create an intent`, async () => {
    let calls = 0;
    const stored = new Map();
    const h = harness(async () => { calls++; return {}; }, stored, overrides);
    await h.run();
    assert.equal(calls, 0);
    assert.equal(stored.size, 0);
  });
}

test('unknown ok=true outcome must remain unresolved, not success', async () => {
  const h = harness(async () => ({ data: { ok: true, outcome: 'unexpected' }, error: null }));
  await h.run();
  assert.equal(h.effects.some(([kind]) => kind === 'success'), false);
  assert.equal(h.keys.current.size, 1, 'unknown response retains retry identity');
});
test('recognized outcome without attendance receipt is unresolved', async () => {
  const h = harness(async () => ({ data: { ok: true, outcome: 'checked_in' }, error: null }));
  await h.run();
  assert.equal(h.effects.some(([kind]) => kind === 'success'), false);
  assert.equal(h.keys.current.size, 1);
});
test('unknown false result must not discard retry identity', async () => {
  const h = harness(async () => ({ data: { ok: false, error: 'unexpected_backend_state' }, error: null }));
  await h.run();
  assert.equal(h.keys.current.size, 1);
});
test('complete canonical receipt is confirmed and journal cleared', async () => {
  const stored = new Map();
  const h = harness(async () => ({ data: { ok: true, outcome: 'checked_in', attendance_id: '00000000-0000-4000-8000-000000000111', shift_date: '2026-10-10' }, error: null }), stored);
  await h.run();
  assert.equal(h.effects.some(([kind]) => kind === 'success'), true);
  assert.equal(h.keys.current.size, 0);
  assert.equal(stored.size, 0);
});

for (const error of ['actor_not_allowed', 'dealer_not_eligible', 'invalid_request', 'IDEMPOTENCY_CONFLICT']) {
  test(`pre-receipt or conflict rejection ${error} preserves unresolved intent`, async () => {
    const stored = new Map();
    await harness(async () => ({ data: null, error: new Error('response lost') }), stored).run();
    const original = [...stored.values()][0];
    const h = harness(async () => ({ data: { ok: false, error }, error: null }), stored);
    await h.run();
    assert.equal(stored.size, 1, 'rejection cannot establish that original request did not commit');
    assert.equal([...stored.values()][0], original);
    assert.equal(h.effects.some(([kind]) => kind === 'success'), false);
  });
}
test('unknown actor cannot dispatch a check-in request', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return {}; }, new Map(), { user: null });
  await h.run();
  assert.equal(calls, 0);
});
test('unmount invalidates an awaited check-in completion', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.run();
  h.unmount();
  finish({ data: { ok: true, outcome: 'checked_in' }, error: null });
  await pending;
  assert.equal(h.keys.current.size, 1);
  assert.deepEqual(h.effects, [['processing', 'checkin']]);
});
test('two clicks before React rerender send one request', async () => {
  const completions = [];
  const h = harness(() => new Promise(resolve => completions.push(resolve)));
  const first = h.run();
  const second = h.run();
  const count = completions.length;
  completions.forEach(resolve => resolve({ data: null, error: new Error('response lost') }));
  await Promise.all([first, second]);
  assert.equal(count, 1);
});
test('storage write failure blocks RPC before dispatch', async () => {
  let calls = 0;
  const stored = new Map();
  stored.set = () => { throw new Error('quota'); };
  const h = harness(async () => { calls++; return {}; }, stored);
  await h.run();
  assert.equal(calls, 0);
  assert.equal(h.effects.some(([kind]) => kind === 'success'), false);
});
test('unknown commit response followed by remount must reuse request identity', async () => {
  const stored = new Map();
  const sent = [];
  const rpc = async (_name, args) => { sent.push(args.p_request_id); return { data: null, error: new Error('response lost') }; };
  await harness(rpc, stored).run();
  await harness(rpc, stored).run();
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1], 'remount cannot create a second intent for unknown commit');
});
test('changing shift cannot create a second intent while the first is unresolved', async () => {
  const stored = new Map();
  const rpc = async () => ({ data: null, error: new Error('lost') });
  await harness(rpc, stored).run();
  let sent = 0;
  const h = harness(async () => { sent++; return {}; }, stored, {
    checkinShiftId: 'other-shift', eligibleCheckinShifts: [{ id: 'other-shift' }],
  });
  await h.run();
  assert.equal(sent, 0);
  assert.equal(stored.size, 1);
});
test('closed shift with a persisted exact intent remains recoverable without a new key', async () => {
  const stored = new Map();
  const sent = [];
  await harness(async (_name, args) => { sent.push(args.p_request_id); return { data: null, error: new Error('lost') }; }, stored).run();
  const h = harness(async (name, args) => {
    assert.equal(name, 'get_dealer_checkin_receipt_v1', 'recovery reads receipt, not another mutation');
    sent.push(args.p_request_id);
    return { data: { ok: true, status: 'committed', result: { ok: true, outcome: 'checked_in', attendance_id: '00000000-0000-4000-8000-000000000111', shift_date: '2026-10-10' } }, error: null };
  }, stored, { eligibleCheckinShifts: [] });
  await h.run();
  assert.equal(sent.length, 2, 'existing receipt must be reconciled despite shift closure');
  assert.equal(sent[0], sent[1]);
  assert.equal(stored.size, 0, 'exact committed receipt clears the pending intent');
});
test('late previous-scope response must not remove intent or mutate current UI', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.run();
  h.changeScope('other-actor', 'other-club');
  finish({ data: { ok: true, outcome: 'checked_in' }, error: null });
  await pending;
  assert.equal(h.keys.current.size, 1, 'old unresolved intent remains for its actor');
  assert.deepEqual(h.effects, [['processing', 'checkin']], 'old finally cannot clear newer processing');
});
test('ABA scope replacement cannot revive an old check-in completion', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.run();
  h.changeScope('other-actor', 'other-club');
  h.changeScope('actor', 'club');
  finish({ data: { ok: true, outcome: 'checked_in' }, error: null });
  await pending;
  assert.equal(h.keys.current.size, 1);
  assert.deepEqual(h.effects, [['processing', 'checkin']]);
});
test('late re-check-in candidate read cannot open dialog for a replaced scope', async () => {
  const recheckStart = source.indexOf('  const doReCheckin =');
  const recheckEnd = source.indexOf('  // ── Special Dates', recheckStart);
  assert.ok(recheckStart >= 0 && recheckEnd > recheckStart);
  const code = ts.transpileModule(source.slice(recheckStart, recheckEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const scope = { current: { key: 'actor:club' } };
  const effects = [];
  let finish;
  const context = {
    checkinScope: scope,
    loadCheckinDealers: () => new Promise(resolve => { finish = resolve; }),
    setCheckinDealerIds: value => effects.push(['selection', value]),
    setCheckinShiftId: value => effects.push(['shift', value]),
    setCheckinOpen: value => effects.push(['open', value]),
  };
  const run = new Function(...Object.keys(context), `${code}; return doReCheckin;`)(...Object.values(context));
  const pending = run('old-dealer');
  scope.current = { key: 'actor:other-club' };
  finish();
  await pending;
  assert.deepEqual(effects, []);
});

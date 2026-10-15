import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts', import.meta.url), 'utf8');
const start = source.indexOf('  const handleStartHand = async () => {');
const end = source.indexOf('  const handleContinueOrphan =', start);
assert.ok(start >= 0 && end > start);
const body = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

for (const startCapability of ['denied', 'loading', 'error', 'allowed']) {
 for (const blindLineageUnavailable of [false,true]) {
  test(`start handler checks ${startCapability} authority and lineageUnavailable=${blindLineageUnavailable}`, async () => {
    let calls = 0;
    const context = {
      startCapability, blindLineageUnavailable, LINEAGE_READ_UNAVAILABLE:'lineage unavailable TEST',
      startingRef: { current: false }, tableId: 'physical', handNumber: 1,
      user: { id: 'floor-actor' }, tournamentId: 'tour', buttonConfirmed: true, buttonSeat: 1,
      players: [{ is_active: true, current_stack: 20000, seat_number: 1 }],
      availableTables: [{ id: 'physical', tableSessionId: 'session', tournamentTableId: 'tt', controlEpoch: 2 }],
      FEATURES: { floorDeferredTrackerMoveV1: true },
      setSubmitting() {}, setActionSyncBlocked() {}, markSync() {},
      toast: { error() {}, success() {} }, orphanHand: null, setOrphanHand() {},
      buildStartHandBody: x => x,
      supabase: { functions: { invoke: async () => { calls++; return { data: { error: 'actor_not_allowed' }, error: null }; } } },
      readEdgeError: async () => 'actor_not_allowed',
    };
    const run = new Function(...Object.keys(context), `${body}; return handleStartHand;`)(...Object.values(context));
    await run();
    assert.equal(calls, startCapability === 'allowed' && !blindLineageUnavailable ? 1 : 0,
      'only verified Tracker authority with available lineage context may reach the writer');
  });
 }
}

const authorityStart = source.indexOf('  const startScope =');
const authorityEnd = source.indexOf('  const [selectedActorId', authorityStart);
assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
const authorityBody = ts.transpileModule(source.slice(authorityStart, authorityEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function authorityHarness(permission, actorId = 'actor') {
  const published = [];
  let cleanup;
  let focus;
  let authChanged;
  const context = {
    user: { id: 'actor' }, tournamentId: 'tour', tableReloadAttempt: 0,
    useState: () => [null, value => published.push(value)],
    useEffect: effect => { cleanup = effect(); },
    setUser() {},
    window: { addEventListener: (_, listener) => { focus = listener; }, removeEventListener() {} },
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: actorId } }, error: null }),
        onAuthStateChange: callback => { authChanged = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { club_id: 'club' }, error: null }) }) }) }),
      rpc: permission,
    },
  };
  new Function(...Object.keys(context), authorityBody)(...Object.values(context));
  return { published, cleanup: () => cleanup(), focus: () => focus(), changeActor: id => authChanged('SIGNED_IN', { user: { id } }) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
for (const [value, expected] of [[true, 'allowed'], [false, 'denied'], [null, 'error']]) {
  test(`actual permission reader classifies ${value} as ${expected}`, async () => {
    const h = authorityHarness(async (name, args) => {
      assert.equal(name, 'is_club_tracker');
      assert.deepEqual(args, { _user_id: 'actor', _club_id: 'club' });
      return { data: value, error: null };
    });
    await flush();
    assert.equal(h.published.at(-1).state, expected);
    h.cleanup();
  });
}
test('actor mismatch never queries previous actor permission', async () => {
  let calls = 0;
  const h = authorityHarness(async () => { calls++; return { data: true, error: null }; }, 'other');
  await flush();
  assert.equal(calls, 0); assert.equal(h.published.at(-1).state, 'error'); h.cleanup();
});
test('unmount fences a late successful authority response', async () => {
  let finish;
  const h = authorityHarness(() => new Promise(resolve => { finish = resolve; }));
  await flush(); h.cleanup(); finish({ data: true, error: null }); await flush();
  assert.equal(h.published.at(-1).state, 'loading');
});
test('new focus read fences older successful response', async () => {
  let finish; let calls = 0;
  const h = authorityHarness(() => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: false, error: null }));
  await flush(); h.focus(); await flush(); finish({ data: true, error: null }); await flush();
  assert.equal(h.published.at(-1).state, 'denied'); h.cleanup();
});
test('account change invalidates permission and fences previous actor response', async () => {
  let finish;
  const h = authorityHarness(() => new Promise(resolve => { finish = resolve; }));
  await flush(); h.changeActor('other'); finish({ data: true, error: null }); await flush();
  assert.equal(h.published.at(-1), null); h.cleanup();
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dealNextHand } from '../../supabase/functions/_shared/pokerRuntime/dealNextHand.ts';
import { loadCreateAction } from './createAction.fixture.mjs';
import * as engine from '../../supabase/functions/_shared/pokerEngine/index.ts';
import * as adapter from '../../supabase/functions/_shared/pokerAdapter/index.ts';

test('manual deal sends the same authoritative hand to persistence and returns its receipt', async () => {
  const tableId = '181a034d-c701-4e76-91d6-2a05e28ec6e1';
  const actor = '63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43';
  const other = '081a034d-c701-4e76-91d6-2a05e28ec6e1';
  const rows = {
    online_poker_tables: { id: tableId, sb: 25, bb: 50, status: 'open', max_seats: 9, act_timeout_secs: 30 },
    online_poker_seats: [
      { seat_no: 2, user_id: actor, stack: 1000, status: 'sitting' },
      { seat_no: 5, user_id: other, stack: 1000, status: 'sitting' },
    ],
    online_poker_hands: { hand_no: 7, button_seat: 5 },
  };
  let started;
  const admin = {
    from(name) {
      assert.ok(Object.hasOwn(rows, name));
      const result = { data: rows[name], error: null };
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => result,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return query;
    },
    async rpc(name, args) {
      if (name === 'op_is_enabled') return { data: true, error: null };
      assert.equal(name, 'op_start_hand');
      assert.equal(started, undefined);
      started = args;
      return { data: { outcome: 'ok', hand_id: args.p_state.config.handId, state_version: 0 }, error: null };
    },
  };
  const user = { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) } };
  const handler = loadCreateAction((_url, key) => key === 'ANON_TEST' ? user : admin, [], undefined, dealNextHand);

  const response = await handler(new Request('http://local.invalid/action', {
    method: 'POST', headers: { authorization: 'Bearer LOCAL_TEST_ONLY', 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'start_hand', tableId, idempotencyKey: 'manual-start-fixture' }),
  }));

  assert.equal(response.status, 200);
  assert.equal(started.p_actor_user_id, actor);
  assert.equal(started.p_state.config.handNo, 8);
  assert.equal(started.p_state.config.buttonSeat, 2);
  assert.doesNotMatch(JSON.stringify(started.p_state), /"deck"|"holeCards"/);
  assert.deepEqual(await response.json(), { outcome: 'ok', hand_id: started.p_state.config.handId, state_version: 0 });
});

test('retry through the Edge handler returns the committed terminal action after a lost response', async () => {
  const tableId = '181a034d-c701-4e76-91d6-2a05e28ec6e1';
  const handId = 'd51603a7-e388-4e10-8d19-5949c8fcf6a1';
  const actor = '63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43';
  const opponent = '081a034d-c701-4e76-91d6-2a05e28ec6e1';
  const first = engine.createHand({
    handId, tableId, handNo: 1, buttonSeat: 2, sb: 5n, bb: 10n,
  }, engine.makeDeck(), [{ seat: 2, playerId: actor, stack: 100n }, { seat: 5, playerId: opponent, stack: 100n }]);
  assert.equal(first.error, undefined);
  assert.equal(first.state.toAct, 2);
  const split = adapter.serializeAuthoritative(first.state);
  let context = { outcome: 'ok', state: split.stateJson, live_deck: split.liveDeck, holes: split.holes, state_version: 0 };
  let committed = 0;
  let stored;
  let loadUnavailable = false;
  const admin = {
    from(name) {
      assert.equal(name, 'online_poker_actions');
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: stored ?? null, error: null }) };
      return query;
    },
    async rpc(name, args) {
      if (name === 'op_is_enabled') return { data: true, error: null };
      if (name === 'op_load_action_context') return loadUnavailable
        ? { data: null, error: { code: 'fixture_unavailable' } } : { data: context, error: null };
      assert.equal(name, 'op_submit_action');
      assert.equal(committed++, 0);
      context = { ...context, state: args.p_new_state, live_deck: args.p_board_future, state_version: 1 };
      stored = { user_id: actor, hand_id: handId, action: args.p_action, response: { outcome: 'ok', hand_id: handId, state_version: 1 } };
      return { data: stored.response, error: null };
    },
  };
  let requestActor = actor;
  const user = { auth: { getUser: async () => ({ data: { user: { id: requestActor } }, error: null }) } };
  const handler = loadCreateAction((_url, key) => key === 'ANON_TEST' ? user : admin, [], undefined, dealNextHand, { engine, adapter });
  const request = (type = 'fold') => new Request('http://local.invalid/action', {
    method: 'POST', headers: { authorization: 'Bearer LOCAL_TEST_ONLY', 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'submit_action', handId, seat: 2, type, idempotencyKey: 'terminal-fold-fixture' }),
  });
  assert.equal((await handler(request())).status, 200);
  assert.equal(context.state.status, 'complete');
  const retry = await handler(request());
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ok: true, handId, stateVersion: 1 });
  loadUnavailable = true;
  const retryWithoutState = await handler(request());
  assert.equal(retryWithoutState.status, 200);
  assert.deepEqual(await retryWithoutState.json(), { ok: true, handId, stateVersion: 1 });
  loadUnavailable = false;
  const changedIntent = await handler(request('call'));
  assert.equal(changedIntent.status, 409);
  assert.equal(Object.hasOwn(await changedIntent.json(), 'view'), false);
  requestActor = opponent;
  const foreign = await handler(request());
  assert.equal(foreign.status, 409);
  assert.deepEqual(await foreign.json(), { ok: false, code: 'forbidden' });
  assert.equal(committed, 1);
});

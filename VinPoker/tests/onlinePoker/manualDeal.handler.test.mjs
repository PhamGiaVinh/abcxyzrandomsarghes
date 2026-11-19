import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dealNextHand } from '../../supabase/functions/_shared/pokerRuntime/dealNextHand.ts';
import { loadCreateAction } from './createAction.fixture.mjs';

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

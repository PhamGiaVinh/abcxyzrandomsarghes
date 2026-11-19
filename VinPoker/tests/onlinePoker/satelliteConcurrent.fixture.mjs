import assert from 'node:assert/strict';

export async function verifyConcurrentSatelliteTables({ sql, json, post, participants, prepareTable, observeTable }) {
  const groups = [participants.slice(0, 2), participants.slice(2, 4), participants.slice(4, 6)];
  assert.equal(new Set(participants.map(player => player.actor)).size, 6);
  const tables = groups.map(group => ({ group, tableId: prepareTable(group) }));
  const observers = await Promise.all(tables.map(({ tableId, group }) => observeTable(tableId, group)));
  const ackMs = [];
  const peerMs = [];
  const actors = new Set();
  const handsPerTable = 4;
  for (let wave = 0; wave < handsPerTable; wave++) {
    const hands = await Promise.all(tables.map(async ({ group, tableId }) => {
      const response = await post({ op: 'start_hand', tableId, idempotencyKey: crypto.randomUUID() }, group[0].token);
      const hand = await response.json();
      assert.equal(response.status, 200);
      assert.equal(hand.outcome, 'ok');
      return hand.hand_id;
    }));
    const turns = json(`SELECT json_object_agg(h.id,json_build_object('actor',s.user_id,'seat',s.seat_no))
      FROM public.online_poker_hands h JOIN public.online_poker_seats s
      ON s.table_id=h.table_id AND s.seat_no=h.to_act_seat
      WHERE h.id IN (${hands.map(id => `'${id}'`).join(',')})`);
    await Promise.all(hands.map(async (handId, index) => {
      const { actor, seat } = turns[handId];
      const actingIndex = groups[index].findIndex(player => player.actor === actor);
      assert.ok(actingIndex >= 0);
      const started = performance.now();
      const response = await post({ op: 'submit_action', handId, seat, type: 'fold',
        idempotencyKey: crypto.randomUUID() }, groups[index][actingIndex].token);
      const receipt = await response.json();
      ackMs.push(performance.now() - started);
      assert.equal(response.status, 200);
      assert.equal(receipt.ok, true);
      assert.equal(receipt.stateVersion, 1);
      const delivered = await observers[index][1 - actingIndex].receive(handId);
      assert.equal(delivered.revision, 1);
      peerMs.push(delivered.at - started);
      actors.add(actor);
    }));
  }
  for (const { tableId } of tables) {
    assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${tableId}' AND status='complete'`), String(handsPerTable));
    assert.equal(sql(`SELECT sum(stack) FROM public.online_poker_seats WHERE table_id='${tableId}'`), '200');
  }
  assert.equal(actors.size, participants.length);
  const p95 = samples => Math.round(samples.sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1]);
  console.log('SATELLITE_CONCURRENT_TABLES_DIAGNOSTIC', JSON.stringify({
    tables: tables.length, authenticatedPlayers: actors.size, completedHands: ackMs.length,
    peerUpdates: peerMs.length, ackP95Ms: p95(ackMs), peerP95Ms: p95(peerMs),
    chips: 600, capacityQualified: false,
  }));
}

import assert from 'node:assert/strict';

export async function verifySatelliteIntakeClosesDuringHand({ sql, json, post, players, newcomer, prepareTable }) {
  const tableId = prepareTable(players);
  const club = sql(`SELECT club_id FROM public.online_poker_tables WHERE id='${tableId}'`);
  const otherClub = crypto.randomUUID();
  const pilot = crypto.randomUUID();
  const otherPilot = crypto.randomUUID();
  const target = crypto.randomUUID();
  const otherTarget = crypto.randomUUID();
  const owner = players[0].actor;
  const register = (id) => `SET ROLE authenticated; SET request.jwt.claim.sub='${newcomer.actor}';
    SELECT public.register_online_satellite_pilot_v1('${id}')`;
  sql(`INSERT INTO public.clubs(id,owner_id) VALUES ('${otherClub}','${owner}');
    INSERT INTO online_satellite_private.registration_gate(club_id,enabled) VALUES ('${otherClub}',true);
    INSERT INTO public.club_members(club_id,player_user_id) VALUES
      ('${club}','${newcomer.actor}'),('${otherClub}','${newcomer.actor}');
    INSERT INTO public.tournaments VALUES
      ('${target}','${club}','Disposable intake target'),('${otherTarget}','${otherClub}','Disposable control target');
    INSERT INTO online_satellite_private.pilots VALUES
      ('${pilot}','${club}','${target}','${owner}','${pilot}',now()+interval '1 day',100,2),
      ('${otherPilot}','${otherClub}','${otherTarget}','${owner}','${otherPilot}',now()+interval '1 day',100,2);`);
  const response = await post({ op: 'start_hand', tableId, idempotencyKey: crypto.randomUUID() });
  assert.equal(response.status, 200);
  const started = await response.json();
  assert.equal(started.outcome, 'ok');
  sql(`UPDATE online_satellite_private.registration_gate SET enabled=false WHERE club_id='${club}'`);
  assert.throws(() => sql(register(pilot)), /SATELLITE_PILOT_NOT_AVAILABLE/);
  assert.equal(sql(`SELECT count(*) FROM online_satellite_private.entries WHERE pilot_id='${pilot}'`), '0');
  assert.equal(json(register(otherPilot)).idempotent, false);

  const turn = json(`SELECT json_build_object('actor',s.user_id,'seat',s.seat_no)
    FROM public.online_poker_hands h JOIN public.online_poker_seats s
    ON s.table_id=h.table_id AND s.seat_no=h.to_act_seat
    WHERE h.id='${started.hand_id}' AND h.status='betting'`);
  const player = players.find(candidate => candidate.actor === turn.actor);
  assert.ok(player);
  const intent = { op: 'submit_action', handId: started.hand_id, seat: turn.seat, type: 'fold',
    idempotencyKey: crypto.randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await post(intent, player.token);
    assert.equal(result.status, 200);
    const receipt = await result.json();
    assert.equal(receipt.ok, true);
    assert.equal(receipt.handId, started.hand_id);
    assert.equal(receipt.stateVersion, 1);
  }
  assert.equal(sql(`SELECT status||':'||state_version FROM public.online_poker_hands WHERE id='${started.hand_id}'`), 'complete:1');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${started.hand_id}'`), '1');
  assert.equal(sql(`SELECT sum(stack) FROM public.online_poker_seats WHERE table_id='${tableId}'`), '200');
  console.log('SATELLITE_CLUB_INTAKE_CLOSED_ACTIVE_HAND_AND_RECEIPT_PRESERVED_PASS');
}

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { computeVoiceFinishSettlement } from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';

const prepareBrowser = process.env.VINPOKER_EARLYITM1181_PREPARE_BROWSER === '1';
assert.equal(process.env.VINPOKER_EARLYITM1180_LOCAL, '1');
const attempt = process.env.VINPOKER_EARLYITM1180_ATTEMPT;
assert.match(attempt ?? '', /^[a-z0-9]+$/);
const base = `D:/Quy trình/output/reports/earlyitm${prepareBrowser ? '1181-browser-fixture' : '1180-same-hand'}-${attempt}-local-20261028`;
assert.equal(existsSync(base + '.sql'), false);
const source = readFileSync('D:/Quy trình/output/reports/earlyitm1171-global-payment-bridge-6-local-20261028.sql', 'utf8');
for (const path of ['20261027155124_multiday_individual_rank_confirmation_v1.sql', '20261027172548_multiday_individual_verified_payment_v1.sql']) {
  assert.ok(source.includes(readFileSync('supabase/pending-migrations/' + path, 'utf8')), 'qualified source drift: ' + path);
}
const cutoff = " r:=public.floor_bust_player_v3(seeded_entry,rev,epoch,amount_before::integer,gen_random_uuid(),'Early ITM1161 canonical bust TEST');";
assert.equal(source.split(cutoff).length, 2);
const rollback = source.slice(source.indexOf("ROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)"));
assert.ok(rollback.startsWith('ROLLBACK;'));
const args = ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres',
  `PGDATABASE=${prepareBrowser ? 'vinpoker_earlyitm1172_local' : 'vinpoker_ranking860_local'}`, 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const child = spawn('wsl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '', transcript = '', terminal = false;
const done = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', code => { terminal = true; resolve(code); });
});
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const send = sql => { transcript += sql + '\n'; child.stdin.write(sql + '\n'); };
const until = async marker => {
  const deadline = Date.now() + 25000;
  while (!stdout.includes(marker)) {
    assert.equal(terminal, false, stderr);
    assert.ok(Date.now() < deadline, marker + ' unavailable: ' + stderr);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
const rows = () => stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(JSON.parse);
const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
let failed;
try {
  let preparation = source.slice(0, source.indexOf(cutoff));
  if (prepareBrowser) {
    const fixtureStart = source.indexOf('-- Transaction-private business qualification only, not persistent gate activation.');
    const headerEnd = source.indexOf('BEGIN;\nSET LOCAL statement_timeout');
    assert.ok(fixtureStart > headerEnd && headerEnd > 0);
    preparation = source.slice(0, headerEnd) + String.raw`BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_earlyitm1172_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_EARLYITM1172_OWNED_LOCAL_SOURCE_ranking860_HEAD_ef6a26948';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT to_regclass('private.multi_day_individual_payment_commits_v1') IS NOT NULL;
END $$;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';
` + source.slice(fixtureStart, source.indexOf(cutoff));
    preparation = preparation.replaceAll('D2 913 Flight physical TEST ', `D2 1181 ${attempt} Flight TEST `)
      .replaceAll('Early ITM1161 physical TEST ', `Early ITM1181 ${attempt} physical TEST `)
      .replace('SELECT coalesce(max(table_number),0)+10 INTO table_no FROM public.game_tables WHERE club_id=club;',
        'SELECT n INTO STRICT table_no FROM generate_series(0,94)n WHERE NOT EXISTS(SELECT 1 FROM public.game_tables WHERE club_id=club AND table_number BETWEEN n+1 AND n+5) ORDER BY n LIMIT 1;');
  }
  send(preparation + String.raw`
 PERFORM set_config('role','none',true);
 UPDATE public.tournaments SET registration_closed_at=now() WHERE id=final;
 PERFORM set_config('role','authenticated',true);
 r:=public.update_blind_structure(final,'[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]'::jsonb);
 ASSERT r->>'status'='success' AND (r->>'levels_saved')::integer=1,r::text;
 snap:=public.get_public_tournament_redraw_v1(final);
 r:=public.floor_continue_tournament_redraw_v1((plan->>'planId')::uuid,(snap->>'redraw_revision')::bigint,gen_random_uuid());
 ASSERT r->>'ok'='true',r::text;
 r:=public.floor_start_tournament_clock(final);ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE tournament_id=final AND redraw_hold_batch_id IS NOT NULL);
 SELECT seat.tournament_table_id,seat.table_session_id INTO STRICT tt,sess
 FROM public.tournament_seats seat WHERE seat.tournament_id=final AND seat.is_active
 GROUP BY seat.tournament_table_id,seat.table_session_id HAVING count(*)=3 ORDER BY seat.tournament_table_id LIMIT 1;
 SELECT revision,control_epoch INTO STRICT rev,epoch FROM public.table_sessions WHERE id=sess AND closed_at IS NULL;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_request_table_control_mode_v4(tt,sess,'tracker',rev,epoch,gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 SELECT control_epoch INTO STRICT epoch FROM public.table_sessions WHERE id=sess AND control_mode='tracker' AND closed_at IS NULL;
 SELECT min(seat_number) INTO j FROM public.tournament_seats WHERE tournament_table_id=tt AND is_active;
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3(final,tt,sess,epoch,1,now(),actor,j);ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);
 PERFORM set_config('test.e1180.fixture',jsonb_build_object('event',event,'tour',final,'club',club,'actor',actor,
  'table',tt,'session',sess,'epoch',epoch,'hand',r->>'hand_id','button',j)::text,true);
END $$;
SELECT current_setting('test.e1180.fixture')::jsonb;
SELECT jsonb_build_object('handPlayers',jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,
 'seat_number',seat_number,'starting_stack',starting_stack) ORDER BY seat_number)) FROM public.hand_players
 WHERE hand_id=(current_setting('test.e1180.fixture')::jsonb->>'hand')::uuid;
SELECT 'EARLY1180_STARTED';
`);
  await until('EARLY1180_STARTED');
  const fixture = rows().find(row => row.event);
  const players = rows().find(row => row.handPlayers).handPlayers;
  assert.equal(players.length, 3);
  assert.ok(players.every(player => player.starting_stack === 20000));
  players.forEach((player, index) => { player.hole_cards = [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']][index]; });
  const actions = [{ index: 1, type: 'post_sb', amount: 100 }, { index: 2, type: 'post_bb', amount: 200 },
    { index: 0, type: 'all_in', amount: 20000 }, { index: 1, type: 'all_in', amount: 19900 },
    { index: 2, type: 'all_in', amount: 19800 }].map((action, index) => ({
    player_id: players[action.index].player_id, entry_number: players[action.index].entry_number,
    street: 'preflop', action_type: action.type, action_amount: action.amount, action_order: index + 1,
  }));
  const board = ['2c', '3d', '7h', '8s', '9c'];
  const settlement = await computeVoiceFinishSettlement({ handId: fixture.hand, stateVersion: '1180-canonical-rollback',
    buttonSeat: fixture.button, communityCards: board, players, actions, bettingComplete: true });
  assert.equal(settlement.potSize, 60000);
  assert.deepEqual(settlement.recordPlayers.map(player => player.ending_stack), [60000, 0, 0]);
  send(`SET LOCAL ROLE authenticated;\n${actions.map(action => `DO $$ DECLARE result jsonb;BEGIN result:=public.record_action('${fixture.hand}','${action.player_id}','${action.action_type}',${action.action_order},${action.entry_number},'preflop',${action.action_amount});ASSERT result->>'status'='success',result::text;END $$;`).join('\n')}
SELECT public.update_community_cards('${fixture.hand}',${json(board)},'${fixture.actor}');RESET ROLE;
SELECT jsonb_build_object('revision',source_revision) FROM public.tournament_hands WHERE id='${fixture.hand}';SELECT 'EARLY1180_ACTIONS';`);
  await until('EARLY1180_ACTIONS');
  const revision = rows().find(row => Object.hasOwn(row, 'revision')).revision;
  const intent = { actor_id: fixture.actor, request_id: randomUUID(), tournament_id: fixture.tour,
    tournament_table_id: fixture.table, hand_id: fixture.hand, table_session_id: fixture.session,
    control_epoch: fixture.epoch, source_revision: revision, payload: { hand_time: new Date().toISOString(),
      players: settlement.recordPlayers, actions: settlement.recordActions, community_cards: board,
      side_pots: settlement.sidePots, pot_size: settlement.potSize } };
  let verification = `DO $verify$ DECLARE result jsonb;review jsonb;receipt jsonb;quote jsonb;owed jsonb;
 ordered uuid[];provisional uuid[];request uuid:=gen_random_uuid();participant uuid;position integer;before_confirm text;
BEGIN
 PERFORM set_config('role','authenticated',true);
 result:=public.record_tracker_manual_hand_v1(${json(intent)});ASSERT result->>'ok'='true',result::text;
 ASSERT public.record_tracker_manual_hand_v1(${json(intent)})=result,'Finish replay changed';
 review:=public.get_multi_day_individual_rank_review_v1('${fixture.event}');
 ASSERT (review->'ranking'->>'survivors')::integer=6 AND (review->'ranking'->>'requiresReview')::boolean;
 ASSERT jsonb_array_length(review->'ranking'->'simultaneousGroups')=1,review::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=2 FROM public.tournament_eliminations WHERE hand_id='${fixture.hand}');
 ASSERT (SELECT sum(chip_count)=160000 FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='${fixture.tour}' AND finished_place IS NOT NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 WHERE event_id='${fixture.event}');
 ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 WHERE event_id='${fixture.event}');
 SELECT array_agg(id ORDER BY bust_order DESC) INTO provisional FROM public.tournament_entries WHERE tournament_id='${fixture.tour}' AND status='busted';
 ordered:=ARRAY[provisional[2],provisional[1]]; -- Explicit Floor choice, opposite provisional order within this same hand.
 before_confirm:=pg_temp.d2_789_fingerprint();
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.confirm_multi_day_individual_ranks_v1('${fixture.event}',review->>'sourceHash',ARRAY[ordered[1]],gen_random_uuid());
  RAISE EXCEPTION 'incomplete same-hand Floor order accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_rank_entries_mismatch' THEN RAISE;END IF;END;
 PERFORM set_config('role','none',true);
 ASSERT pg_temp.d2_789_fingerprint()=before_confirm;
 PERFORM set_config('role','authenticated',true);
 receipt:=public.confirm_multi_day_individual_ranks_v1('${fixture.event}',review->>'sourceHash',ordered,request);
 ASSERT receipt->>'ok'='true' AND jsonb_array_length(receipt->'individualResults')=2,receipt::text;
 ASSERT public.confirm_multi_day_individual_ranks_v1('${fixture.event}',review->>'sourceHash',ordered,request)=receipt;
 ASSERT public.get_multi_day_individual_rank_receipt_v1('${fixture.event}',request)->'receipt'=receipt;
 BEGIN
  PERFORM public.confirm_multi_day_individual_ranks_v1('${fixture.event}',review->>'sourceHash',provisional,gen_random_uuid());
  RAISE EXCEPTION 'same-hand frozen Floor ranks reversed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_rank_frozen_conflict' THEN RAISE;END IF;END;
 ASSERT public.get_multi_day_individual_rank_receipt_v1('${fixture.event}',request)->'receipt'=receipt;
 FOR position IN 1..2 LOOP
  PERFORM set_config('role','none',true);
  SELECT participation_id INTO STRICT participant FROM private.multi_day_individual_results_v1 WHERE entry_id=ordered[position] AND finished_place=6+position;
  PERFORM set_config('role','authenticated',true);
  quote:=public.get_multi_day_individual_obligation_preview_v1('${fixture.event}',participant);
  owed:=public.confirm_multi_day_individual_obligation_v1('${fixture.event}',participant,quote->'quote'->>'quoteHash',quote->'funding'->>'sourceInputHash',quote->'budget'->>'budgetHash',gen_random_uuid());
  ASSERT owed->>'ok'='true',owed::text;
 END LOOP;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=2 AND sum(amount_vnd)=200000 FROM private.multi_day_individual_obligations_v1 WHERE event_id='${fixture.event}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='${fixture.tour}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${fixture.event}');
 SET CONSTRAINTS ALL IMMEDIATE;SET CONSTRAINTS ALL DEFERRED;
 PERFORM set_config('test.e1180.result',jsonb_build_object('fixture',current_setting('test.e1180.fixture')::jsonb,
  'sameHandBusts',2,'survivors',6,'potChips',60000,'totalActiveChips',160000,'automaticRanks',0,
  'floorOrderedEntryIds',to_jsonb(ordered),'provisionalEntryIds',to_jsonb(provisional),
  'confirmedRanks',receipt->'individualResults','obligations',2,'owedVnd',200000,'payments',0,'globalFinalizations',0,
  'incompleteOrderRejected',true,'frozenOrderReversalRejected',true,'rankReplayAndReceiptIdentical',true)::text,true);
END $verify$;
SELECT current_setting('test.e1180.result')::jsonb;
${rollback}
SELECT 'EARLY1180_ROLLBACK_VERIFIED';`;
  if (prepareBrowser) {
    const stop = verification.indexOf(' SELECT array_agg(id ORDER BY bust_order DESC)');
    assert.ok(stop > 0);
    verification = verification.slice(0, stop) + `
 SELECT array_agg(id ORDER BY bust_order DESC) INTO provisional FROM public.tournament_entries WHERE tournament_id='${fixture.tour}' AND status='busted';
 ordered:=ARRAY[provisional[2],provisional[1]];
 PERFORM set_config('test.e1181.fixture',(current_setting('test.e1180.fixture')::jsonb||jsonb_build_object(
  'final','${fixture.tour}','expectedOrder',to_jsonb(ordered),'provisionalOrder',to_jsonb(provisional),
  'entries',(SELECT jsonb_agg(jsonb_build_object('entry',e.id,'participation',p.id,'player',e.player_id,'expectedRank',6+array_position(ordered,e.id)) ORDER BY array_position(ordered,e.id))
   FROM public.tournament_entries e JOIN public.multi_day_final_seatings_v1 s ON s.entry_id=e.id
   JOIN public.multi_day_final_participations_v1 p ON p.id=s.participation_id WHERE e.id=ANY(ordered))))::text,true);
END $verify$;
SELECT jsonb_build_object('fixture',current_setting('test.e1181.fixture')::jsonb,'initialRanks',0,'initialObligations',0,'initialPayments',0,'survivors',6,'sameHandBusts',2);
COMMIT;
SELECT 'EARLY1181_UNCONFIRMED_FIXTURE_COMMITTED';`;
  }
  send(verification);
  child.stdin.end();
  assert.equal(await done, 0, stderr);
  assert.ok(stdout.includes(prepareBrowser ? 'EARLY1181_UNCONFIRMED_FIXTURE_COMMITTED' : 'EARLY1180_ROLLBACK_VERIFIED'));
  const observations = rows();
  assert.equal(observations.find(row => row.sameHandBusts)?.sameHandBusts, 2);
  if (!prepareBrowser) assert.equal(observations.at(-1).paymentBaselineFunctionsRestored, true);
  writeFileSync(base + '.json', JSON.stringify({ kind: prepareBrowser ? 'UNCONFIRMED_CANONICAL_SAME_HAND_BROWSER_FIXTURE' : 'CANONICAL_MULTIDAY_SAME_HAND_FINISH_MANUAL_FLOOR_RANK_OBLIGATION_ROLLBACK',
    observations, durablyApplied: prepareBrowser, browserAccepted: false, fullR03Accepted: false }, null, 2));
  console.log(prepareBrowser ? 'EARLYITM1181_UNCONFIRMED_SAME_HAND_OWNED_CLONE_FIXTURE_READY' : 'EARLYITM1180_TWO_CANONICAL_SAME_HAND_BUSTS_FLOOR_RANK7_8_OWED200K_ROLLBACK_PASS');
} catch (error) {
  failed = error;
  writeFileSync(base + '.failure.log', String(error.stack) + '\n' + stderr);
  throw error;
} finally {
  if (!terminal && !child.stdin.writableEnded) child.stdin.end('ROLLBACK;\n');
  await done;
  writeFileSync(base + '.sql', transcript);
  writeFileSync(base + '.raw.log', stdout + '\nSTDERR:\n' + stderr);
  const fingerprint = source.slice(source.indexOf('LANGUAGE sql AS $$') + 'LANGUAGE sql AS $$'.length, source.indexOf('$$;'));
  const sourceArgs = args.map(value => value === 'PGDATABASE=vinpoker_earlyitm1172_local' ? 'PGDATABASE=vinpoker_ranking860_local' : value);
  const after = execFileSync('wsl', sourceArgs, { input: 'BEGIN READ ONLY;' + fingerprint + ';ROLLBACK;', encoding: 'utf8', timeout: 20000 }).trim();
  try { assert.equal(after, 'd354baf55b242145f987cec754ec854b'); }
  catch (error) { if (!failed) throw error; console.error('1180 original source postcheck failed', error.message); }
  writeFileSync(base + '.post.json', JSON.stringify({ original41Fingerprint: after, unchanged: after === 'd354baf55b242145f987cec754ec854b' }));
}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
export async function probeRetainedFinishReplay(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
 const hand=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${id}';`));
 assert.equal(hand.status,'in_progress','pre-Finish rollback probe only; after UI completion use receipt/history checks, never reset the retained hand');assert.equal(hand.source_revision,13);
 const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${id}';`));
 const actions=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(a) ORDER BY action_order) FROM public.hand_actions a WHERE hand_id='${id}';`));
 assert.deepEqual(players.map(p=>p.starting_stack),[59400,600]);assert.equal(actions.length,5);
 const result=await computeVoiceFinishSettlement({handId:id,stateVersion:'local-rollback',buttonSeat:1,communityCards:hand.community_cards,players,actions,bettingComplete:true});
 assert.equal(result.potSize,1200);assert.deepEqual(result.recordPlayers.map(p=>p.ending_stack),[59400,600]);
 const intent={actor_id:actor,request_id:randomUUID(),tournament_id:hand.tournament_id,tournament_table_id:hand.tournament_table_id,
  hand_id:id,table_session_id:hand.table_session_id,control_epoch:2,source_revision:13,
  payload:{hand_time:hand.hand_time,players:result.recordPlayers,actions:result.recordActions,side_pots:result.sidePots,community_cards:hand.community_cards,pot_size:1200}};
 const quote=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('status',status,'rev',source_revision,'pot',pot_size,
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE p.hand_id=h.id),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE a.hand_id=h.id))::text)
  FROM public.tournament_hands h WHERE id='${id}';`);
 const before=fingerprint();
 try{
  const output=sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';
   DO $$ DECLARE i jsonb:=${quote(intent)};r jsonb;BEGIN
    PERFORM set_config('role','authenticated',true);
    r:=public.record_action('${id}','${players[1].player_id}','bet',6,${players[1].entry_number},'preflop',1);
    IF r->>'error' IS DISTINCT FROM 'tracker_action_stack_exceeded' THEN RAISE EXCEPTION 'finish191_budget_guard_weakened:%',r;END IF;
    r:=public.record_tracker_manual_hand_v1(i);
    IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'valid_finish191_rejected:%',r;END IF;
    IF public.record_tracker_manual_hand_v1(i) IS DISTINCT FROM r THEN RAISE EXCEPTION 'finish191_replay_changed';END IF;
    PERFORM set_config('role','none',true);
    IF (SELECT count(*) FROM public.hand_actions WHERE hand_id='${id}')<>5 THEN RAISE EXCEPTION 'finish191_duplicate_action';END IF;
    IF (SELECT status FROM public.tournament_hands WHERE id='${id}')<>'completed' THEN RAISE EXCEPTION 'finish191_not_completed';END IF;
   END $$;ROLLBACK;SELECT 'FINISH191_VALID_RECORDED_SHORT_ALLIN_EXACT_REPLAY_ROLLBACK_PASS';`);
  assert.match(output,/FINISH191_VALID_RECORDED_SHORT_ALLIN_EXACT_REPLAY_ROLLBACK_PASS/);
 }finally{assert.equal(fingerprint(),before,'rollback changed retained UI hand');}
 console.log('FINISH191_VALID_RECORDED_SHORT_ALLIN_EXACT_REPLAY_ROLLBACK_PASS');
}

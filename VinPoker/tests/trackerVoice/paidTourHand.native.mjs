import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';

export async function runPaidTourHand(sql,f,tables){
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
 const quote=v=>`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
 const session=t=>JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${t.table_session_id}';`));
 const core=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'))::text);`);
 const switchMode=(t,mode)=>{const s=session(t);const r=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_request_table_control_mode_v4('${t.id}','${s.id}','${mode}',${s.revision},${s.control_epoch},'${crypto.randomUUID()}');COMMIT;`));assert.equal(r.ok,true);return r;};
 const before=core();
 const primaryId=sql(`SELECT tournament_table_id FROM public.tournament_seats WHERE entry_id='${f.entry}' AND is_active;`);
 const table=tables.find(t=>t.id===primaryId),otherTable=tables.find(t=>t.id!==primaryId);assert.ok(table&&otherTable);
 const cash=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}';`);
 const cashBefore=cash();
 const otherSeats=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM public.tournament_seats s WHERE tournament_table_id='${otherTable.id}';`);
 const otherBefore=otherSeats();
 for(const t of tables){const original=session(t);assert.equal(original.control_mode,'manual');
  switchMode(t,'tracker');assert.equal(session(t).control_mode,'tracker');switchMode(t,'manual');assert.equal(session(t).control_mode,'manual');assert.ok(session(t).control_epoch>original.control_epoch);
 }
 assert.equal(core(),before,'occupied mode transitions must preserve seats/entries/chips/cash');
 switchMode(table,'tracker');const startedSession=session(table);
 const globalBefore=sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');");
 try{
  sql(`BEGIN;INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  INSERT INTO public.tracker_voice_configs(club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,control_epoch,enabled,configured_mode)
  SELECT '${f.club}','${f.tour}','${table.id}',game_table_id,id,control_epoch,true,'assist' FROM public.table_sessions WHERE id='${startedSession.id}'
  ON CONFLICT(tournament_id,tournament_table_id) DO UPDATE SET enabled=true,configured_mode='assist',table_session_id=excluded.table_session_id,control_epoch=excluded.control_epoch;COMMIT;`);
  let r=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_start_tournament_clock('${f.tour}');COMMIT;`));assert.equal(r.ok,true);
  const button=Number(sql(`SELECT min(seat_number) FROM public.tournament_seats WHERE tournament_table_id='${table.id}' AND is_active;`));
  r=JSON.parse(sql(`BEGIN;${auth}SELECT public.start_tracker_hand_v3('${f.tour}','${table.id}','${startedSession.id}',${startedSession.control_epoch},1,now(),'${f.actor}',${button});COMMIT;`));assert.equal(r.status,'success');
  const hand=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id='${f.tour}' AND status='in_progress';`));
  const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));assert.equal(players.length,4);
  r=switchMode(table,'manual');assert.equal(r.outcome,'pending');assert.ok(r.blockers.includes('active_hand'));assert.equal(session(table).control_mode,'tracker');
  const waiting=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_get_table_control_mode_request_v1('${table.id}','${startedSession.id}');COMMIT;`));assert.ok(waiting.request.id);
  const cancel=()=>JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_cancel_table_control_mode_request_v1('${table.id}','${startedSession.id}','${waiting.request.id}');COMMIT;`));
  const cancelled=cancel();assert.equal(cancelled.ok,true);assert.deepEqual(cancel(),cancelled);
  assert.equal(session(table).control_mode,'tracker');assert.equal(core(),before);
  const cleared=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_get_table_control_mode_request_v1('${table.id}','${startedSession.id}');COMMIT;`));assert.equal(cleared.request,null);
  r=switchMode(table,'manual');assert.equal(r.outcome,'pending');
  for(const [player,type,order,amount] of [[players[1],'post_sb',1,100],[players[2],'post_bb',2,200],[players[3],'fold',3,0],[players[0],'fold',4,0],[players[1],'fold',5,0]]){
   r=JSON.parse(sql(`BEGIN;${auth}SELECT public.record_action('${hand.id}','${player.player_id}','${type}',${order},${player.entry_number},'preflop',${amount});COMMIT;`));assert.equal(r.status,'success');
  }
  const snapshot=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}','${hand.id}');COMMIT;`));assert.equal(snapshot.ok,true);
  const runtime=reduceHand(snapshot.players,snapshot.actions,snapshot.button_seat);assert.equal(runtime.players.filter(p=>!p.is_folded).length,1);
  const settlement=await computeVoiceFinishSettlement({handId:hand.id,stateVersion:snapshot.state_version,buttonSeat:snapshot.button_seat,communityCards:snapshot.community_cards,
   players,actions:snapshot.actions,bettingComplete:isBettingRoundComplete(runtime)});
  assert.equal(settlement.settlementOrigin,'engine_fold_win');assert.equal(settlement.summary.conservation_total,80000);
  const record={hand_number:hand.hand_number,hand_time:hand.created_at,players:settlement.recordPlayers,actions:settlement.recordActions,side_pots:settlement.sidePots,community_cards:snapshot.community_cards,pot_size:settlement.potSize};
  const key='native-eight-hand-'+crypto.randomUUID();
  r=JSON.parse(sql(`BEGIN;${service}SELECT public.commit_tracker_voice_finish_v0('${f.actor}','${f.tour}','${table.id}','${hand.id}',
  'openai_realtime','gpt-live-transcribe','${key}','ket thuc hand','${snapshot.state_version}','${key}','native-eight-finish','${settlement.settlementOrigin}','${settlement.settlementDigest}',${quote(record)}::jsonb);COMMIT;`));assert.equal(r.ok,true);
  assert.equal(session(table).control_mode,'manual');assert.ok(session(table).control_epoch>startedSession.control_epoch);
  const pending=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_get_table_control_mode_request_v1('${table.id}','${startedSession.id}');COMMIT;`));assert.equal(pending.request,null);
  assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${hand.id}';`),'completed');
  assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'8|160000');
  for(const expected of settlement.recordPlayers){
   assert.equal(Number(sql(`SELECT chip_count FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND player_id='${expected.player_id}' AND is_active;`)),expected.ending_stack);
   assert.equal(Number(sql(`SELECT current_stack FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND player_id='${expected.player_id}' AND entry_no=${expected.entry_number};`)),expected.ending_stack);
  }
  assert.equal(otherSeats(),otherBefore);assert.equal(cash(),cashBefore);
  assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${f.club}' AND status='assigned' AND released_at IS NULL;`),'2');
  console.log('NATIVE_PAID_EIGHT_STAFFED_FOUR_PLAYER_FINISH_PENDING_MODE_PASS',hand.id);
  const worker=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{encoding:'utf8',timeout:120000,
   env:{...process.env,VINPOKER_HISTORY_PARENT_HAND:hand.id,VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(f)}});
  assert.match(worker,/ACTUAL_PAID_PARENT_BASELINE_HISTORY_WORKER_PUBLIC_PASS/);
  process.stdout.write(worker);
  assert.equal(cash(),cashBefore);assert.equal(otherSeats(),otherBefore);
 }finally{
  if(globalBefore==='ABSENT')sql("DELETE FROM public.app_settings WHERE key='tracker_voice_global_enabled';");
  else sql(`UPDATE public.app_settings SET value=${quote(globalBefore)}::jsonb WHERE key='tracker_voice_global_enabled';`);
  assert.equal(sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');"),globalBefore);
 }
}

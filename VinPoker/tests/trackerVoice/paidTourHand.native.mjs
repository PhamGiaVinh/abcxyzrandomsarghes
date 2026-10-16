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

export async function runPaidTourShowdown(sql,f,table){
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
 const quote=v=>`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
 const cash=()=>sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}';`),cashBefore=cash();
 let s=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${table.table_session_id}';`));
 let r=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_request_table_control_mode_v4('${table.id}','${s.id}','tracker',${s.revision},${s.control_epoch},'${crypto.randomUUID()}');COMMIT;`));assert.equal(r.ok,true);
 s=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${s.id}';`));
 const globalBefore=sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');");
 try{
  sql(`BEGIN;INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  INSERT INTO public.tracker_voice_configs(club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,control_epoch,enabled,configured_mode)
  VALUES('${f.club}','${f.tour}','${table.id}','${s.game_table_id}','${s.id}',${s.control_epoch},true,'assist')
  ON CONFLICT(tournament_id,tournament_table_id) DO UPDATE SET enabled=true,configured_mode='assist',table_session_id=excluded.table_session_id,control_epoch=excluded.control_epoch;COMMIT;`);
  const button=Number(sql(`SELECT min(seat_number) FROM public.tournament_seats WHERE tournament_table_id='${table.id}' AND is_active;`));
  r=JSON.parse(sql(`BEGIN;${auth}SELECT public.start_tracker_hand_v3('${f.tour}','${table.id}','${s.id}',${s.control_epoch},2,now(),'${f.actor}',${button});COMMIT;`));assert.equal(r.status,'success');
  const hand=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id='${f.tour}' AND status='in_progress';`));
  let players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));assert.equal(players.length,8);
  const winner=[...players].sort((a,b)=>b.starting_stack-a.starting_stack)[0];
  const others=[['4d','4h'],['5d','5h'],['6d','6h'],['7d','7h'],['8d','8h'],['9d','9h'],['2s','3s']];
  let order=0;
  const action=(p,type,amount)=>{const result=JSON.parse(sql(`BEGIN;${auth}SELECT public.record_action('${hand.id}','${p.player_id}','${type}',${++order},${p.entry_number},'preflop',${amount});COMMIT;`));assert.equal(result.status,'success');};
  action(players[1],'post_sb',100);action(players[2],'post_bb',200);
  for(const p of [...players.slice(3),...players.slice(0,3)])action(p,'all_in',p.starting_stack-(p===players[1]?100:p===players[2]?200:0));
  // Reveal during the canonical all-in runout, before river. The Voice
  // endpoint deliberately rejects river/showdown reveals without muck policy.
  for(const p of players){
   const snapshot=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}','${hand.id}');COMMIT;`));assert.equal(snapshot.ok,true);
   const cards=p.player_id===winner.player_id?['Ac','Kc']:others.shift(),key='native-eight-showdown-hole-'+crypto.randomUUID();
   r=JSON.parse(sql(`BEGIN;${service}SELECT public.commit_tracker_voice_hole_cards_v0('${f.actor}','${f.tour}','${table.id}','${hand.id}',
   'openai_realtime','gpt-live-transcribe','${key}','${snapshot.state_version}','${key}','native-eight-showdown-hole',${p.seat_number},${quote(cards)}::jsonb);COMMIT;`));assert.equal(r.ok,true,JSON.stringify(r));
  }
  for(const board of [['Tc','Jc','Qc'],['Tc','Jc','Qc','2d'],['Tc','Jc','Qc','2d','3h']]){
   // Reconstructed schema omits managed Supabase auth schema USAGE. Model
   // only the official bootstrap grant inside this transaction, restoring it
   // before COMMIT; application table grants, RLS and actor checks stay real.
   const authUsage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");assert.ok(['t','f'].includes(authUsage));
   r=JSON.parse(sql(`BEGIN;${authUsage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}${auth}
    SELECT public.update_community_cards('${hand.id}',${quote(board)}::jsonb,'${f.actor}');
    RESET ROLE;${authUsage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));assert.equal(r.status,'success',JSON.stringify(r));
   assert.equal(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');"),authUsage);
  }
  const snapshot=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}','${hand.id}');COMMIT;`));assert.equal(snapshot.ok,true);
  players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));
  const runtime=reduceHand(snapshot.players,snapshot.actions,snapshot.button_seat);
  const settlement=await computeVoiceFinishSettlement({handId:hand.id,stateVersion:snapshot.state_version,buttonSeat:snapshot.button_seat,communityCards:snapshot.community_cards,
   players,actions:snapshot.actions,bettingComplete:isBettingRoundComplete(runtime)});
  assert.equal(settlement.settlementOrigin,'engine_showdown');assert.equal(settlement.summary.conservation_total,160000);
  assert.equal(settlement.recordPlayers.filter(p=>p.is_eliminated).length,7);assert.equal(settlement.recordPlayers.find(p=>p.player_id===winner.player_id).ending_stack,160000);
  const key='native-eight-showdown-finish-'+crypto.randomUUID(),record={hand_number:hand.hand_number,hand_time:hand.created_at,players:settlement.recordPlayers,actions:settlement.recordActions,
   side_pots:settlement.sidePots,community_cards:snapshot.community_cards,pot_size:settlement.potSize};
  const finish=()=>JSON.parse(sql(`BEGIN;${service}SELECT public.commit_tracker_voice_finish_v0('${f.actor}','${f.tour}','${table.id}','${hand.id}',
   'openai_realtime','gpt-live-transcribe','${key}','ket thuc hand','${snapshot.state_version}','${key}','native-eight-showdown-finish','${settlement.settlementOrigin}','${settlement.settlementDigest}',${quote(record)}::jsonb);COMMIT;`));
  r=finish();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(finish().duplicate,true);
  assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'1|160000');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND status='busted';`),'7');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_eliminations WHERE hand_id='${hand.id}';`),'7');assert.equal(cash(),cashBefore);
  const readiness=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tournament_close_readiness_v1('${f.tour}');COMMIT;`));
  assert.equal(readiness.ok,true);assert.equal(readiness.ready,false);assert.ok(readiness.blockers.includes('active_seats'));
  const prematureClose=JSON.parse(sql(`BEGIN;${auth}SELECT public.close_tournament('${f.tour}','TEST terminal winner readiness probe');ROLLBACK;`));
  assert.equal(prematureClose.ok,false);assert.equal(prematureClose.error,'active_players_remaining');assert.equal(prematureClose.active_players,1);
  assert.equal(sql(`SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='${f.tour}';`),'0');assert.equal(cash(),cashBefore);
  console.log('NATIVE_EIGHT_PAID_ENGINE_SHOWDOWN_SEVEN_ELIMINATIONS_WINNER_CLOSE_BLOCKED_PASS',hand.id,JSON.stringify(readiness.blockers));
  // Use the existing explicit Floor "leave seat, preserve stack" workflow.
  // Never bust the winner, fabricate a place, apply payout or reconcile cash.
  const survivor=JSON.parse(sql(`SELECT to_jsonb(e) FROM public.tournament_entries e WHERE tournament_id='${f.tour}' AND status='seated';`));
  s=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${s.id}';`));
  const leaveKey=crypto.randomUUID();
  const leave=()=>JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_free_sit_player_v1('${survivor.id}',${s.revision},${s.control_epoch},160000,'${leaveKey}','TEST winner leaves completed play with stack preserved');COMMIT;`));
  const left=leave();assert.equal(left.ok,true);assert.equal(left.stack_preserved,160000);assert.equal(left.payout_applied,false);assert.deepEqual(leave(),left);
  const closeRevision=sql(`SELECT revision FROM public.table_sessions WHERE id='${s.id}';`),closeKey=crypto.randomUUID();
  const closeTable=()=>JSON.parse(sql(`BEGIN;${auth}SELECT public.close_tournament_table_v4('${table.id}',${closeRevision},'${closeKey}');COMMIT;`));
  const tableClosed=closeTable();assert.equal(tableClosed.ok,true);assert.deepEqual(closeTable(),tableClosed);
  const ready=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tournament_close_readiness_v1('${f.tour}');COMMIT;`));
  assert.equal(ready.ok,true);assert.equal(ready.ready,true);assert.deepEqual(ready.blockers,[]);
  const close=()=>JSON.parse(sql(`BEGIN;${auth}SELECT public.close_tournament('${f.tour}','TEST completed play no payout or reconciliation');COMMIT;`));
  const closed=close();assert.equal(closed.ok,true);assert.equal(closed.outcome,'closed');assert.equal(closed.reconciled,false);assert.equal(closed.prize_total,0);
  const repeated=close();assert.equal(repeated.ok,true);assert.equal(repeated.outcome,'already_closed');assert.equal(repeated.report_id,closed.report_id);
  assert.equal(sql(`SELECT status FROM public.tournaments WHERE id='${f.tour}';`),'completed');
  assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE tournament_id='${f.tour}' AND closed_at IS NULL;`),'0');
  assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments a JOIN public.table_sessions x ON x.id=a.table_session_id WHERE x.tournament_id='${f.tour}' AND a.released_at IS NULL;`),'0');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'0');
  assert.equal(sql(`SELECT current_stack||'|'||status FROM public.tournament_entries WHERE id='${survivor.id}';`),'160000|registered');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}';`),'0');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='${f.tour}';`),'1');assert.equal(cash(),cashBefore);
  console.log('NATIVE_EIGHT_PAID_WINNER_STACK_PRESERVED_CANONICAL_TABLE_TOUR_CLOSE_REPLAY_PASS',f.tour);
  if(process.env.VINPOKER_NATIVE_PAID_HISTORY==='1'){
   const places=JSON.parse(sql(`SELECT jsonb_agg(finished_place ORDER BY finished_place) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`));
   assert.deepEqual(places,[1,2,3,4,5,6,7,8]);
   assert.equal(sql(`SELECT finished_place FROM public.tournament_entries WHERE id='${survivor.id}';`),'1');
   assert.equal(sql(`SELECT detail->'official_results'->>'status' FROM public.tournament_close_report WHERE tournament_id='${f.tour}';`),'finalized');
   assert.equal(sql(`SELECT count(*) FROM public.player_history_link_errors WHERE club_id='${f.club}';`),'0');
   console.log('NATIVE_EIGHT_PAID_HISTORY_ENABLED_MEMBER_LINKS_AND_OFFICIAL_PLACES_PASS',f.tour);
  }
  const worker=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],{encoding:'utf8',timeout:120000,
   env:{...process.env,VINPOKER_HISTORY_PARENT_HAND:hand.id,VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(f),VINPOKER_HISTORY_PARENT_SHOWDOWN:'1'}});
  assert.match(worker,/ACTUAL_PAID_TERMINAL_SHOWDOWN_HISTORY_WORKER_PUBLIC_VERIFIED_PASS/);process.stdout.write(worker);assert.equal(cash(),cashBefore);
 }finally{
  if(globalBefore==='ABSENT')sql("DELETE FROM public.app_settings WHERE key='tracker_voice_global_enabled';");
  else sql(`UPDATE public.app_settings SET value=${quote(globalBefore)}::jsonb WHERE key='tracker_voice_global_enabled';`);
  assert.equal(sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');"),globalBefore);
 }
}

import assert from 'node:assert/strict';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';
import {computePotBreakdown,contributionsFromActions,toSidePotsJson} from '../../supabase/functions/_shared/trackerEngine/potEngine.ts';

export async function probeMultipleSidepotDbBoundary(sql){
 const {verifyHistoricalDisplaySettlement}=await import('../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts');
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const q=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const cards=[['As','Ad'],['Ks','Kd'],['Qs','Qd'],['Js','Jd']],board=['2c','4d','6h','8s','Tc'];
 const players=[10,20,30,40].map((stack,i)=>({player_id:`P${i+1}`,entry_number:1,seat_number:i+1,
  starting_stack:stack,ending_stack:40-i*10,hole_cards:cards[i],is_eliminated:false}));
 const actions=players.map((p,i)=>({id:`multi-${i}`,hand_id:'multiple-pot-local',player_id:p.player_id,entry_number:1,
  street:'preflop',action_type:'all_in',action_amount:p.starting_stack,action_order:i+1}));
 const finish=await computeVoiceFinishSettlement({handId:'multiple-pot-local',stateVersion:'local-only',buttonSeat:1,
  communityCards:board,players,actions,bettingComplete:true});
 assert.equal(finish.potSize,90);assert.deepEqual(finish.sidePots.map(p=>p.amount),[40,30,20]);
 assert.deepEqual(finish.recordPlayers.map(p=>p.ending_stack),[40,30,20,10]);
 const result=await verifyHistoricalDisplaySettlement({tournamentId:'local',hand:{id:'multiple-pot-local',tournament_id:'local',
  hand_number:1,table_id:'local-table',button_seat:1,community_cards:board,pot_size:90,side_pots:finish.sidePots,status:'completed',
  is_voided:false,tracker_level_id:'local-level',tracker_level_number:1,tracker_small_blind:1,tracker_big_blind:2,tracker_bba:0,tracker_is_break:false,
  created_at:'2026-10-19T00:00:00Z',updated_at:'2026-10-19T00:00:00Z'},
  players:players.map(p=>({...p,hand_id:'multiple-pot-local'})),actions,sourceRevision:1,sourceChainHash:'a'.repeat(64),settlementRevision:1});
 assert.deepEqual(result.publicOutcome.players.map(p=>p.endingStack),[40,30,20,10]);
 const badEligible=finish.sidePots.map((p,i)=>i===2?{...p,eligible_player_ids:['P1','P4']}:p);
 const test=(pots,total)=>`floor_private.tracker_manual_pots_match_v1(${q(finish.recordActions)},${q(pots)},${total})`;
 const rows=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('valid',${test(finish.sidePots,90)},
  'refundCountedTwice',${test(finish.sidePots,100)},'wrongEligible',${test(badEligible,90)},
  'missingSide',${test(finish.sidePots.slice(0,2),90)});ROLLBACK;`));
 assert.deepEqual(rows,{valid:true,refundCountedTwice:false,wrongEligible:false,missingSide:false});
 console.log('MULTIPLE_SIDE_POTS_FINISH_HISTORY_ACTUAL_PG_BOUNDARY_READONLY_PASS',JSON.stringify({pots:[40,30,20],refund:10,endings:[40,30,20,10],rows}));
}

export function probeDbPotParity(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const action=(player,type,amount)=>({player_id:player,action_type:type,action_amount:amount});
 const cases=[[],[action('a','check',0)], [action('a','bet',500)],
  [action('a','post_sb',100),action('b','post_bb',200),action('a','fold',0)],
  [action('a','all_in',19900),action('b','all_in',20000),action('c','all_in',20100)],
  [action('a','all_in',10),action('b','all_in',20),action('c','all_in',30),action('d','all_in',40)],
  [action('a','bet',10),action('b','bet',20),action('a','fold',0),action('b','fold',0)],
  [action('a','bet',10),action('b','bet',20),action('c','bet',30),action('c','fold',0)],
  [action('a','post_ante',1),action('b','post_ante',1),action('c','post_ante',1)],
 ];
 let seed=183;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let c=0;c<160;c++){
  const actions=[];
  for(let p=0;p<2+random()%8;p++){
   actions.push(action('p'+p,'post_ante',random()%30),action('p'+p,'bet',random()%10000));
   if(random()%3===0)actions.push(action('p'+p,'fold',0));
   else actions.push(action('p'+p,'raise',random()%20000));
  }
  cases.push(actions);
 }
 const probes=cases.map((actions,index)=>{
  const summary=computePotBreakdown(contributionsFromActions(actions)),pots=toSidePotsJson(summary);
  const reversed=pots.map(p=>({...p,eligible_player_ids:[...p.eligible_player_ids].reverse()}));
  const wrong=pots.length?pots.map((p,i)=>i? p:{...p,amount:p.amount+1}):[{amount:1,eligible_player_ids:[]}];
  return `SELECT jsonb_build_object('case',${index},'valid',floor_private.tracker_manual_pots_match_v1(${quote(actions)},${quote(pots)},${summary.totalPot}),
   'order',floor_private.tracker_manual_pots_match_v1(${quote(actions)},${quote(reversed)},${summary.totalPot}),
   'wrong',floor_private.tracker_manual_pots_match_v1(${quote(actions)},${quote(wrong)},${summary.totalPot}),
   'total',floor_private.tracker_manual_pots_match_v1(${quote(actions)},${quote(pots)},${summary.totalPot+1}));`;
 });
 const rows=sql(`BEGIN READ ONLY;${probes.join('\n')}ROLLBACK;`).split('\n').map(line=>JSON.parse(line));
 assert.equal(rows.length,cases.length);
 for(const row of rows)assert.deepEqual(row,{case:row.case,valid:true,order:true,wrong:false,total:false});
 const before=sql(`SELECT md5(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure));`);
 assert.equal(sql(`SELECT has_function_privilege('authenticated','floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)','EXECUTE')
  OR has_function_privilege('anon','floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)','EXECUTE')
  OR has_function_privilege('service_role','floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)','EXECUTE');`),'f');
 const recovery=sql(`BEGIN;REVOKE EXECUTE ON FUNCTION public.record_tracker_manual_hand_v1(jsonb) FROM authenticated;
  SELECT has_function_privilege('authenticated','public.record_tracker_manual_hand_v1(jsonb)','EXECUTE');ROLLBACK;
  SELECT has_function_privilege('authenticated','public.record_tracker_manual_hand_v1(jsonb)','EXECUTE');`);
 assert.equal(recovery,'f\nt');
 assert.equal(sql(`SELECT md5(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure));`),before);
 console.log('DB183_POT_PARITY_169_CASES_676_ASSERTIONS_PRIVATE_ACL_RECOVERY_ROLLBACK_PASS',before);
}

// Backend-only qualification. Never substitute this rolled-back probe for the
// still-open actual controller/observer journey of the retained browser hand.
export async function probeRetainedSidepot(sql,{tampered=false,actionRetries=false,sourceOmission=false}={}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const handId='08730ce1-9a83-4439-96f9-ac005ae3d734',tour='46cab483-91e7-4220-aacf-e17bdf05269c';
 const actor='675fe35e-60a8-4452-bb90-e79486d54da6';
 const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const h=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${handId}' AND tournament_id='${tour}';`));
 assert.equal(h.status,'in_progress');assert.equal(h.source_revision,7);assert.equal(h.hand_number,2);
 const table=JSON.parse(sql(`SELECT to_jsonb(t) FROM public.tournament_tables t WHERE id='${h.table_id}' AND tournament_id='${tour}';`));
 assert.equal(table.table_session_id,'395420ac-28b8-4a9e-a240-eaa82dc0fde3');
 const session=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${table.table_session_id}';`));
 assert.equal(session.control_mode,'tracker');assert.equal(session.closed_at,null);
 assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';`),'f');
 const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${handId}';`));
 assert.equal(players.length,3);
 const short=players.find(p=>p.starting_stack===19900),middle=players.find(p=>p.starting_stack===20000),big=players.find(p=>p.starting_stack===20100);
 assert.ok(short&&middle&&big);short.hole_cards=['As','Ad'];middle.hole_cards=['Ks','Kd'];big.hole_cards=['Qs','Qd'];
 const actions=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'street',street,'action_type',action_type,'action_amount',action_amount,'action_order',action_order) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${handId}';`));
 assert.deepEqual(actions.map(a=>[a.action_type,a.action_amount]),[['post_sb',100],['post_bb',200],['all_in',19900]]);
 const additions=[{player_id:big.player_id,entry_number:big.entry_number,street:'preflop',action_type:'all_in',action_amount:20000,action_order:4},
  {player_id:middle.player_id,entry_number:middle.entry_number,street:'preflop',action_type:'all_in',action_amount:19800,action_order:5}];
 const allActions=[...actions,...additions],board=['2c','3d','7h','9s','Tc'];
 const seeds=players.map(p=>({player_id:p.player_id,seat_number:p.seat_number,starting_stack:p.starting_stack,entry_number:p.entry_number}));
 const runtime=reduceHand(seeds,allActions,h.button_seat);
 assert.equal(isBettingRoundComplete(runtime),true);
 const result=await computeVoiceFinishSettlement({handId,stateVersion:'rollback-probe',buttonSeat:h.button_seat,communityCards:board,
  players,actions:allActions,bettingComplete:true});
 assert.equal(result.potSize,59900);assert.equal(result.summary.conservation_total,60000);
 assert.deepEqual(result.sidePots.map(p=>p.amount),[59700,200]);
 for(const [p,ending] of [[short,59700],[middle,200],[big,100]]){
  assert.equal(result.recordPlayers.find(r=>r.player_id===p.player_id).ending_stack,ending,'independent unequal-stack oracle');
 }
 const payload={hand_time:h.hand_time,players:result.recordPlayers,actions:result.recordActions,
  side_pots:result.sidePots,community_cards:board,pot_size:result.potSize};
 const omittedPayload={...payload,actions:result.recordActions.filter(a=>a.player_id!==short.player_id),
  side_pots:[{amount:40000,eligible_player_ids:[middle.player_id,big.player_id]}],pot_size:40000,
  players:result.recordPlayers.map(p=>({...p,ending_stack:p.player_id===short.player_id?19900:p.player_id===middle.player_id?0:40100,
   is_eliminated:p.player_id===middle.player_id}))};
 assert.equal(omittedPayload.actions.length,result.recordActions.length-1);
 const cards=players.map(p=>({player_id:p.player_id,entry_number:p.entry_number,hole_cards:p.hole_cards}));
 const fingerprintQuery=`SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x WHERE tournament_id='${tour}'),
  'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x WHERE hand_id='${handId}'),
  'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x WHERE hand_id='${handId}'),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='${tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id='${tour}'))::text);`;
 const fingerprint=()=>sql(fingerprintQuery);
 const snapshotStatement=`'${fingerprintQuery.replaceAll("'","''")}'`;
 const before=fingerprint();
 const intent={actor_id:actor,request_id:crypto.randomUUID(),tournament_id:tour,tournament_table_id:table.id,
  hand_id:handId,table_session_id:session.id,control_epoch:session.control_epoch,payload};
 let output;
 try{output=sql(`BEGIN;
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';
 DO $probe$ DECLARE r jsonb; i jsonb:=${quote(intent)}; revision bigint; action_revision bigint; before_negative text;after_negative text; BEGIN
  PERFORM set_config('role','authenticated',true);
  r:=public.heartbeat_lock('${handId}','${actor}');
  IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'sidepot_lock: %',r;END IF;
  ${actionRetries?`
  r:=public.record_action('${handId}','${big.player_id}','all_in',4,${big.entry_number},'preflop',20000,'${intent.request_id}',NULL,'${actor}');
  IF r->>'status' IS DISTINCT FROM 'success' OR r->>'duplicate' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'action_first_write: %',r;END IF;
  PERFORM set_config('role','none',true);
  SELECT source_revision INTO action_revision FROM public.tournament_hands WHERE id='${handId}';
  PERFORM set_config('role','authenticated',true);
  r:=public.record_action('${handId}','${big.player_id}','all_in',4,${big.entry_number},'preflop',20000,'${intent.request_id}',NULL,'${actor}');
  IF r->>'status' IS DISTINCT FROM 'success' OR r->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'action_same_key_replay: %',r;END IF;
  r:=public.record_action('${handId}','${big.player_id}','all_in',4,${big.entry_number},'preflop',19999,'${intent.request_id}',NULL,'${actor}');
  IF r->>'error' IS DISTINCT FROM 'idempotency_key_conflict' THEN RAISE EXCEPTION 'action_changed_payload_accepted: %',r;END IF;
  r:=public.record_action('${handId}','${big.player_id}','all_in',4,${big.entry_number},'preflop',20000,NULL,NULL,'${actor}');
  IF r->>'error' IS DISTINCT FROM 'action_order_conflict' THEN RAISE EXCEPTION 'action_null_key_duplicate_accepted: %',r;END IF;
  PERFORM set_config('role','none',true);
  IF (SELECT count(*) FROM public.hand_actions WHERE hand_id='${handId}') IS DISTINCT FROM 4::bigint
    OR (SELECT source_revision FROM public.tournament_hands WHERE id='${handId}') IS DISTINCT FROM action_revision
    THEN RAISE EXCEPTION 'action_replay_changed_rows_or_revision';END IF;
  RETURN;
  `:''}
  ${additions.map(a=>`r:=public.record_action('${handId}','${a.player_id}','all_in',${a.action_order},${a.entry_number},'preflop',${a.action_amount});
  IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'sidepot_action: %',r;END IF;`).join('\n')}
  r:=public.update_community_cards('${handId}',${quote(board)},'${actor}');
  IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'sidepot_board: %',r;END IF;
  PERFORM set_config('role','none',true);
  SELECT source_revision INTO revision FROM public.tournament_hands WHERE id='${handId}';
  PERFORM set_config('role','authenticated',true);
  r:=public.show_tracker_manual_cards_v1('${handId}','${session.id}',${session.control_epoch},revision,'${crypto.randomUUID()}',${quote(cards)});
  IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'sidepot_cards: %',r;END IF;
  PERFORM set_config('role','none',true);
  SELECT source_revision INTO revision FROM public.tournament_hands WHERE id='${handId}';
  i:=i||jsonb_build_object('source_revision',revision);
  PERFORM set_config('role','authenticated',true);
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{control_epoch}',to_jsonb(${session.control_epoch+1})));
  IF r->>'error' IS DISTINCT FROM 'stale_manual_finish_context' THEN RAISE EXCEPTION 'sidepot_stale_epoch_accepted: %',r;END IF;
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{tournament_id}',to_jsonb('${crypto.randomUUID()}'::text)));
  IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'sidepot_wrong_tour_accepted: %',r;END IF;
  PERFORM set_config('request.jwt.claim.sub','${short.player_id}',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${short.player_id}"}',true);
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{actor_id}',to_jsonb('${short.player_id}'::text)));
  IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'sidepot_outsider_accepted: %',r;END IF;
  PERFORM set_config('request.jwt.claim.sub','${actor}',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true);
  ${tampered?`r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload,side_pots}','[]'::jsonb));
  IF r->>'error' IS DISTINCT FROM 'SIDE_POTS_TAMPERED' THEN RAISE EXCEPTION 'TAMPERED_EMPTY_SIDE_POTS_ACCEPTED_BY_DIRECT_AUTHENTICATED_FINISH: %',r;END IF;
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload,pot_size}','59901'::jsonb));
  IF r->>'error' IS DISTINCT FROM 'SIDE_POTS_TAMPERED' THEN RAISE EXCEPTION 'TAMPERED_TOTAL_POT_ACCEPTED: %',r;END IF;
  RAISE NOTICE 'TAMPERED_SIDE_POTS_DENIED: %',r;`:''}
  ${sourceOmission?`PERFORM set_config('role','none',true);EXECUTE ${snapshotStatement} INTO before_negative;PERFORM set_config('role','authenticated',true);
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload}',${quote(omittedPayload)}));
  IF r->>'error' IS DISTINCT FROM 'action_conflict' THEN RAISE EXCEPTION 'MISSING_RECORDED_ACTION_ACCEPTED_WITH_DIFFERENT_POT: %',r;END IF;
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload}',${quote({...payload,actions:[],side_pots:[],pot_size:0,
   players:result.recordPlayers.map(p=>({...p,ending_stack:p.starting_stack,is_eliminated:false}))})}));
  IF r->>'error' IS DISTINCT FROM 'action_conflict' THEN RAISE EXCEPTION 'EMPTY_ACTIONS_OMISSION_ACCEPTED: %',r;END IF;
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload}',${quote({...payload,actions:result.recordActions.filter(a=>a.action_order!==1)})}));
  IF r->>'error' IS DISTINCT FROM 'action_conflict' THEN RAISE EXCEPTION 'RECORDED_BLIND_OMISSION_ACCEPTED: %',r;END IF;
  PERFORM set_config('role','none',true);EXECUTE ${snapshotStatement} INTO after_negative;PERFORM set_config('role','authenticated',true);
  IF before_negative IS DISTINCT FROM after_negative THEN RAISE EXCEPTION 'SOURCE_ACTION_REJECTION_CHANGED_STATE';END IF;
  RAISE NOTICE 'RECORDED_ALLIN_BLIND_EMPTY_OMISSIONS_REJECTED_ZERO_DELTA';`:''}
  r:=public.record_tracker_manual_hand_v1(i);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'sidepot_finish: %',r;END IF;
  IF (r->>'committed_source_revision')::bigint IS NULL OR (r->>'committed_source_revision')::bigint<=revision THEN RAISE EXCEPTION 'sidepot_revision_proof';END IF;
  IF public.get_tracker_manual_finish_receipt_v1(i) IS DISTINCT FROM r OR public.record_tracker_manual_hand_v1(i) IS DISTINCT FROM r THEN RAISE EXCEPTION 'sidepot_receipt_replay';END IF;
  IF (public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload,pot_size}','59901'::jsonb))->>'error') IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'sidepot_changed_payload_replay';END IF;
  PERFORM set_config('role','none',true);
  IF (SELECT status FROM public.tournament_hands WHERE id='${handId}') IS DISTINCT FROM 'completed' OR (SELECT pot_size FROM public.tournament_hands WHERE id='${handId}') IS DISTINCT FROM 59900 THEN RAISE EXCEPTION 'sidepot_hand_result';END IF;
  ${[[short,59700],[middle,200],[big,100]].map(([p,ending])=>`IF (SELECT ending_stack FROM public.hand_players WHERE hand_id='${handId}' AND player_id='${p.player_id}') IS DISTINCT FROM ${ending}
   OR (SELECT current_stack FROM public.tournament_entries WHERE tournament_id='${tour}' AND player_id='${p.player_id}' AND entry_no=${p.entry_number}) IS DISTINCT FROM ${ending}
   OR (SELECT chip_count FROM public.tournament_seats WHERE tournament_id='${tour}' AND player_id='${p.player_id}' AND is_active) IS DISTINCT FROM ${ending} THEN RAISE EXCEPTION 'sidepot_stack_projection';END IF;`).join('\n')}
  RAISE NOTICE 'CANONICAL_UNEQUAL_STACK_MANUAL_FINISH_RECEIPT_ROLLBACK_PROBE_PASS';
 END $probe$;
 ROLLBACK;
 SELECT '${actionRetries?'CANONICAL_ACTION_REPLAY_CONFLICT_REVISION_ROLLBACK_PASS':'CANONICAL_UNEQUAL_STACK_MANUAL_FINISH_RECEIPT_ROLLBACK_PROBE_PASS'}';`);
 }finally{assert.equal(fingerprint(),before,'rollback must preserve retained UI hand and paid projections');}
 assert.match(output,actionRetries?/CANONICAL_ACTION_REPLAY_CONFLICT_REVISION_ROLLBACK_PASS/:/CANONICAL_UNEQUAL_STACK_MANUAL_FINISH_RECEIPT_ROLLBACK_PROBE_PASS/);
 assert.equal(fingerprint(),before,'rollback must preserve retained UI hand and paid projections');
 console.log(actionRetries?'ACTION_RETRY_RETAINED_ROLLBACK_NO_PERSISTED_HAND_CASH_SEAT_DELTA_PASS':'SIDEPOT_RETAINED_ROLLBACK_NO_PERSISTED_HAND_CASH_SEAT_DELTA_PASS',JSON.stringify(actionRetries?{handId,checks:['same_key_replay','changed_payload_conflict','null_key_order_conflict','no_duplicate_revision']}:{handId,pot:59900,total:60000,endings:[59700,200,100]}));
 if(sourceOmission)console.log('RECORDED_SOURCE_ALLIN_BLIND_EMPTY_OMISSIONS_REJECTED_VALID_FINISH_REPLAY_NO_DELTA_PASS');
}

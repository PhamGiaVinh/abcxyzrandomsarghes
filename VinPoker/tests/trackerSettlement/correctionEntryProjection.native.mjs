import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaidCompletedHandFixture} from '../cashier/paidJourney.fixture.mjs';
import {runPaidCorrectionEdge} from './paidCorrectionEdge.native.mjs';
import {computeAuthoritativeSettlement,normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';

export async function runCorrectionEntryNegatives({sql,session,until,legacyOnly=false,scopeOnly=false}){
 const hand='5fb31e3a-6ad9-45ca-9628-ef114cfa7c04',tour='a43f49a7-bf31-4972-8ef9-f6fc2ea9802e',actor='0ba0b14e-ecce-4dbc-b561-5cc48b8cda3d';
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id WHERE h.id='${hand}' AND t.id='${tour}' AND c.owner_id='${actor}' AND h.status='completed' AND NOT h.is_voided;`),'1');
 const snapshot=JSON.parse(sql(`SELECT public.get_tracker_historical_display_snapshot('${hand}',NULL);`));
 const source=normalizeSettlementSourceRpcResult(JSON.parse(sql(`SELECT to_jsonb(s) FROM public.get_tournament_settlement_source_hash('${hand}')s;`)));
 const sb=snapshot.players.find(p=>p.seat_number===snapshot.hand.tracker_sb_position),bb=snapshot.players.find(p=>p.seat_number===snapshot.hand.tracker_bb_position);assert.ok(sb&&bb);
 const actions=[[sb,'post_sb',100],[bb,'post_bb',200],[sb,'fold',0]].map(([p,type,amount],i)=>({hand_id:hand,player_id:p.player_id,entry_number:p.entry_number,street:'preflop',action_type:type,action_amount:amount,action_order:i+1}));
 const liveStacks=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'chip_count',chip_count)) FROM public.tournament_chip_counts WHERE tournament_id='${tour}';`));
 const revision=Number(sql(`SELECT max(settlement_revision)+1 FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';`));
 const result=await computeAuthoritativeSettlement({tournamentId:tour,targetHandId:hand,hands:[snapshot.hand],players:snapshot.players,actions:snapshot.actions,liveStacks,edit:{actions},actor:{userId:actor,role:'club_owner_or_admin'},sourceRevisionOverride:source.sourceRevision,sourceChainHashOverride:source.sourceChainHash,settlementRevisionOverride:revision});
 const quote=v=>`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${tour}'),
  'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id='${tour}'),
  'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE tournament_id='${tour}'),
  'sessions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.table_sessions t WHERE tournament_id='${tour}'),
  'physical',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.game_tables g WHERE id IN(SELECT game_table_id FROM public.tournament_tables WHERE tournament_id='${tour}')),
  'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${hand}'),
  'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='${hand}'))::text);`);
 const role='correction107_neg_'+randomUUID().replaceAll('-','');sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
 const commitCall=(stacks,key)=>`public.commit_tracker_hand_correction_outcome('${hand}','${actor}',${source.sourceRevision},${quote(source.sourceChainHash)},${revision},${quote(result.privateOutcome.outcomeHash)},repeat('c',64),${quote(key)},${quote(result.publicOutcome)}::jsonb,${quote(result.persistedEdit)}::jsonb,${quote(result.handChanges)}::jsonb,${quote(stacks)}::jsonb,'TEST correction107 rollback rejection')`;
 try{
  if(scopeOnly){
   // The catalog prevents this malformed state before the correction RPC runs.
   // Keep that evidence distinct from the writer's own session checks below.
   const before=fingerprint();
   sql(`BEGIN;SET LOCAL statement_timeout='10s';DO $test$ DECLARE constraint_name text;BEGIN BEGIN
    UPDATE public.game_tables g SET table_name='scope109-${randomUUID()}',club_id=(SELECT c.id FROM public.clubs c WHERE c.id<>g.club_id AND NOT EXISTS(SELECT 1 FROM public.game_tables other WHERE other.club_id=c.id AND other.table_number=g.table_number) ORDER BY c.id LIMIT 1)
     WHERE g.id=(SELECT tt.game_table_id FROM public.tournament_tables tt JOIN public.tournament_seats s ON s.tournament_table_id=tt.id WHERE s.tournament_id='${tour}' AND s.player_id='${sb.player_id}' AND s.is_active);
    RAISE EXCEPTION 'scope109_cross_club_not_rejected';
   EXCEPTION WHEN foreign_key_violation THEN GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
    IF constraint_name<>'table_sessions_game_table_club_v3_fkey' THEN RAISE;END IF;
   END;END $test$;ROLLBACK;`);
   assert.equal(fingerprint(),before);
   console.log('CORRECTION_SCOPE109_EXISTING_CATALOG_FK_CROSS_CLUB_REJECTED_BEFORE_WRITER_ROLLBACK_PASS');
   sql(`BEGIN;SET LOCAL statement_timeout='10s';DO $test$ DECLARE constraint_name text;BEGIN BEGIN
    UPDATE public.tournament_tables SET table_session_id=NULL WHERE id=(SELECT tournament_table_id FROM public.tournament_seats WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND is_active);
    RAISE EXCEPTION 'scope109_referenced_session_detach_not_rejected';
   EXCEPTION WHEN foreign_key_violation THEN GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
    IF constraint_name<>'tournament_hands_table_session_match_v3_fkey' THEN RAISE;END IF;
   END;END $test$;ROLLBACK;`);
   assert.equal(fingerprint(),before);
   console.log('CORRECTION_SCOPE109_EXISTING_CATALOG_FK_SESSION_DETACH_REJECTED_BEFORE_WRITER_ROLLBACK_PASS');
  }
  for(const [name,fault,code,state,finalStacks]of(scopeOnly?[
   ['closed-session',`UPDATE public.table_sessions SET closed_at=now() WHERE id=(SELECT table_session_id FROM public.tournament_seats WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND is_active);`,'stale_seat_stack','40001',result.finalStacks],
   ['closed-assignment',`UPDATE public.tournament_tables SET status='closed' WHERE id=(SELECT tournament_table_id FROM public.tournament_seats WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND is_active);`,'stale_seat_stack','40001',result.finalStacks],
  ]:legacyOnly?[
   ['null-session',`UPDATE public.tournament_seats SET table_session_id=NULL WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND entry_number=${sb.entry_number} AND is_active;`,'stale_seat_stack','40001',result.finalStacks],
   ['inactive-only',`UPDATE public.tournament_seats SET is_active=false,status='busted',chip_count=0 WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND entry_number=${sb.entry_number} AND is_active;`,'stale_seat_stack','40001',result.finalStacks],
  ]:[
   ['entry',`UPDATE public.tournament_entries SET current_stack=current_stack+1 WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND entry_no=${sb.entry_number};`,'stale_entry_stack','40001',result.finalStacks],
   ['seat',`UPDATE public.tournament_seats SET chip_count=chip_count+1 WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND entry_number=${sb.entry_number} AND is_active;`,'stale_seat_stack','40001',result.finalStacks],
   ['duplicate','', 'invalid_final_stack_identity','22023',[...result.finalStacks,result.finalStacks[0]]],
  ])){
   const before=fingerprint();
   sql(`BEGIN;SET LOCAL statement_timeout='10s';${fault}SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE ${role};
    DO $test$ BEGIN BEGIN
     PERFORM ${commitCall(finalStacks,'negative107-'+name+'-'+randomUUID())};
     RAISE EXCEPTION 'negative107_not_rejected';
    EXCEPTION WHEN SQLSTATE '${state}' THEN IF SQLERRM<>${quote(code)} THEN RAISE;END IF;END;END $test$;ROLLBACK;`);
   assert.equal(fingerprint(),before,'rejected correction changed source/proofs/projections: '+name);
   console.log('CORRECTION199_REAL_SQL_REJECTION_ROLLBACK_PASS',name,code);
  }
  if(legacyOnly){
   const historical=randomUUID(),before=fingerprint();
   sql(`BEGIN;SET LOCAL statement_timeout='10s';
    INSERT INTO public.tournament_seats SELECT (jsonb_populate_record(NULL::public.tournament_seats,to_jsonb(s)||jsonb_build_object('id','${historical}','is_active',false,'status','busted','chip_count',0))).*
    FROM public.tournament_seats s WHERE s.tournament_id='${tour}' AND s.player_id='${sb.player_id}' AND s.entry_number=${sb.entry_number} AND s.is_active;
    SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE ${role};
    SELECT ${commitCall(result.finalStacks,'historical108-'+randomUUID())};RESET ROLE;
    DO $test$ BEGIN
     IF (SELECT count(*) FROM public.tournament_seats WHERE id='${historical}' AND NOT is_active AND status='busted' AND chip_count=0)<>1 THEN RAISE EXCEPTION 'historical108_seat_rewritten';END IF;
     IF (SELECT count(*) FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE e.tournament_id='${tour}' AND e.player_id IN('${sb.player_id}','${bb.player_id}') AND e.current_stack=s.chip_count AND e.current_stack=c.chip_count)<>2 THEN RAISE EXCEPTION 'historical108_active_projection_mismatch';END IF;
    END $test$;ROLLBACK;`);
   assert.equal(fingerprint(),before,'legacy qualification must roll back the child and source/proofs');
   console.log('CORRECTION199_CURRENT_ACTIVE_ENTRY_ONLY_HISTORICAL_BUSTED_SEAT_UNCHANGED_ROLLBACK_PASS');
  }
  if(session&&until){
   const suffix=randomUUID().slice(0,8),holderName='correction199_entry_holder_'+suffix,writerName='correction199_writer_'+suffix;
   const holder=session(holderName),writer=session(writerName),before=fingerprint();
   try{
    holder.child.stdin.write(`BEGIN;SELECT id FROM public.tournament_entries WHERE tournament_id='${tour}' AND player_id='${sb.player_id}' AND entry_no=${sb.entry_number} FOR UPDATE;\n`);
    await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holderName}' AND wait_event='ClientRead' AND xact_start IS NOT NULL);`)==='t');
    writer.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE ${role};SELECT ${commitCall(result.finalStacks,'concurrent107-'+randomUUID())};COMMIT;\n`);
    await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE application_name='${writerName}' AND wait_event_type='Lock' AND (SELECT pid FROM pg_stat_activity WHERE application_name='${holderName}')=ANY(pg_blocking_pids(w.pid)));`)==='t');
    assert.equal(fingerprint(),before,'uncommitted correction leaked while waiting for canonical entry lock');
    holder.child.stdin.end('ROLLBACK;\n');await holder.closed;
    const committed=JSON.parse((await writer.closed).split('\n').find(line=>line.startsWith('{')));assert.equal(committed.ok,true);
    assert.equal(sql(`SELECT count(*) FROM public.hand_players p JOIN public.tournament_entries e ON e.tournament_id='${tour}' AND e.player_id=p.player_id AND e.entry_no=p.entry_number JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE p.hand_id='${hand}' AND p.ending_stack=e.current_stack AND s.chip_count=e.current_stack AND c.chip_count=e.current_stack;`),'2');
    console.log('CORRECTION199_TRUE_TWO_SESSION_ENTRY_LOCK_WAIT_NO_PARTIAL_VISIBILITY_PARITY_PASS');
   }finally{
    for(const tx of[holder,writer])if(!tx.child.stdin.writableEnded)tx.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([holder.closed,writer.closed]);
   }
  }
 }finally{sql(`DROP ROLE ${role};`);}
}

// Dedicated regression child, not a replacement for the retained browser tour.
export async function runCorrectionEntryProjection({sql}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const {fixture,hand}=createPaidCompletedHandFixture(sql,{verified:true});
 console.log('CORRECTION107_REGRESSION_CHILD',JSON.stringify({fixture,hand}));
 const cash=()=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]')::text) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}';`),cashBefore=cash();
 const role='correction107_'+randomUUID().replaceAll('-','');
 sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
 const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${role};`;
 const table=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
 const scope=sql(`INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
  VALUES('${fixture.club}','${fixture.tour}','${table}','${fixture.actor}','correct_completed_hand',true,now()+interval '10 minutes') RETURNING id;`);
 try{
  await runPaidCorrectionEdge({sql,service,fixture,hand,scenario:async({invoke,errors})=>{
   const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand}';`));
   const positions=JSON.parse(sql(`SELECT jsonb_build_object('sb',tracker_sb_position,'bb',tracker_bb_position) FROM public.tournament_hands WHERE id='${hand}';`));
   const sb=players.find(p=>p.seat_number===positions.sb),bb=players.find(p=>p.seat_number===positions.bb);
   assert.ok(sb&&bb);assert.equal(players.length,2);
   const actions=[[sb,'post_sb',100],[bb,'post_bb',200],[sb,'call',100],[bb,'fold',0]].map(([p,type,amount],i)=>({player_id:p.player_id,entry_number:p.entry_number,street:'preflop',action_type:type,action_amount:amount,action_order:i+1}));
   const body={mode:'preview',tournament_id:fixture.tour,hand_id:hand,expected_actor_id:fixture.actor,correction_reason:'TEST correction107 entry projection regression',edit:{actions},
    expected_target_ending_stacks:players.map(p=>({player_id:p.player_id,entry_number:p.entry_number,ending_stack:p.starting_stack+(p.player_id===sb.player_id?200:-200)}))};
   const previewResponse=await invoke(body),preview=await previewResponse.json();assert.equal(previewResponse.status,200,JSON.stringify({preview,errors}));
   const commit={...body,mode:'commit',idempotency_key:randomUUID(),expected_source_revision:preview.source_revision,expected_source_chain_hash:preview.source_chain_hash,expected_outcome_hash:preview.outcome_hash};
   const response=await invoke(commit),receipt=await response.json();assert.equal(response.status,200,JSON.stringify({receipt,errors}));
   const projections=()=>JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('player',p.player_id,'ending',p.ending_stack,'entry',e.current_stack,'seat',s.chip_count,'count',c.chip_count) ORDER BY p.seat_number)
    FROM public.hand_players p JOIN public.tournament_seats s ON s.tournament_id='${fixture.tour}' AND s.player_id=p.player_id AND s.entry_number=p.entry_number AND s.is_active
    JOIN public.tournament_entries e ON e.id=s.entry_id JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE p.hand_id='${hand}';`));
   const state=projections();console.log('CORRECTION107_AFTER_REAL_EDGE_COMMIT',JSON.stringify({hand,key:commit.idempotency_key,state}));
   assert.equal(state.length,2);
   for(const p of state){assert.equal(p.entry,p.ending,'entry.current_stack not synchronized by correction');assert.equal(p.seat,p.ending);assert.equal(p.count,p.ending);}
   assert.equal(cash(),cashBefore);
   // Same durable intent resolves without reapplying any chip projection.
   const before=JSON.stringify(state),resolve=await invoke({mode:'resolve',tournament_id:fixture.tour,hand_id:hand,expected_actor_id:fixture.actor,idempotency_key:commit.idempotency_key,
    expected_source_revision:preview.source_revision,expected_source_chain_hash:preview.source_chain_hash,expected_outcome_hash:preview.outcome_hash,expected_request_hash:preview.request_hash});
   assert.equal(resolve.status,200);assert.equal((await resolve.json()).status,'receipt_found');assert.equal(JSON.stringify(projections()),before);assert.equal(cash(),cashBefore);assert.deepEqual(errors,[]);
   console.log('ACTUAL_CORRECTION107_EDGE_SQL_ENTRY_SEAT_COUNT_PARITY_RESOLVE_NO_DELTA_PASS');
  }});
 }finally{sql(`DROP ROLE ${role};DELETE FROM public.tracker_correction_uat_scopes WHERE id='${scope}' AND tournament_id='${fixture.tour}';`);}
}

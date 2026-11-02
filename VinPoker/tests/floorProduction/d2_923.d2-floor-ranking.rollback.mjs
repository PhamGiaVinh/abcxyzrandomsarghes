// Full initial D2 draw from the same two-flight SUM_STACKS fixture. No fixture
// or feature gate survives the outer transaction; this is native SQL, not E2E.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';
import {verifyHistoricalDisplaySettlement} from '../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts';
import {normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';

assert.equal(process.env.VINPOKER_D2_923_LOCAL,'1');
const source=readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql','utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const marker=' FOR i IN 1..3 LOOP\n  seat_result:=';
const cut=source.indexOf(marker);
assert.ok(cut>0 && source.indexOf(marker,cut+1)<0,'fixture boundary drift');
const request=randomUUID();
const sql=source.slice(0,cut)+`
 PERFORM set_config('role','none',true);
 INSERT INTO public.club_settings(club_id,player_history_enabled) VALUES(club,true);
 PERFORM set_config('role','authenticated',true);
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(snap->'players')x WHERE x->>'state'='UNSEATED'),'not eight unseated';
 ASSERT (SELECT count(*)=3 FROM jsonb_array_elements(snap->'tables')x WHERE x->>'blocker' IS NULL),'table blockers before draw';
 plan:=public.multi_day_plan_initial_draw_v1(event,selected,snap->>'sourceHash','${request}'::uuid);
 ASSERT plan->>'state'='PLANNED' AND jsonb_array_length(plan->'assignments')=8,plan::text;
 p:=(plan->>'planId')::uuid;
 applied:=public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 ASSERT applied->>'state'='APPLIED' AND jsonb_array_length(applied->'seatReceipts')=8,applied::text;
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(snap->'players')x WHERE x->>'state'='SEATED'),'not eight seated';
 ASSERT (SELECT count(*)=8 AND sum(current_stack)=320000 FROM public.tournament_entries WHERE tournament_id=final),'entry/stack mismatch';
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=320000 FROM public.tournament_seats WHERE tournament_id=final AND is_active),'seat/chip mismatch';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=8 FROM public.multi_day_final_seatings_v1 WHERE final_tournament_id=final),'saved final seating mismatch';
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true);
 r:=public.get_public_tournament_redraw_v1(final);
 PERFORM set_config('role','none',true);
 ASSERT r->>'kind'='initial_d2' AND jsonb_array_length(r->'moves')=8,r::text;
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(r->'moves')m
  JOIN public.tournament_tables t ON t.tournament_id=final AND t.table_number=(m->>'to_table_number')::integer
  JOIN public.tournament_seats s ON s.tournament_id=final AND s.tournament_table_id=t.id
   AND s.seat_number=(m->>'to_seat_number')::integer AND s.is_active),'TV/seat mismatch';
 state:=r;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 recorded:=public.floor_continue_tournament_redraw_v1(p,(state->>'redraw_revision')::bigint,gen_random_uuid());
 ASSERT recorded->>'ok'='true' AND (recorded->>'redraw_revision')::integer=2,recorded::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=0 FROM public.table_sessions WHERE tournament_id=final AND redraw_hold_batch_id=p),'hold not cleared';
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=sessions[1];
 r:=public.get_public_tournament_redraw_v1(final);
 ASSERT r->>'batch_id' IS NULL AND r->'moves'='[]'::jsonb,'TV not cleared';
 UPDATE public.tournaments SET current_level=1 WHERE id=final;
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break)
 VALUES(final,1,100,200,0,false);
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_request_table_control_mode_v4(selected[1],sessions[1],'tracker',rev,epoch,gen_random_uuid());
 ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=sessions[1];
 dealer:=gen_random_uuid();attendance:=gen_random_uuid();shift:=gen_random_uuid();
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',actor)::text,true);
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,club,'D2 919 hand TEST','00:00','23:59');
 INSERT INTO public.dealers(id,club_id,full_name,status) VALUES(dealer,club,'D2 919 hand TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
 VALUES(attendance,dealer,shift,current_date,'checked_in',now(),'assigned');
 INSERT INTO public.dealer_assignments(table_id,table_session_id,club_id,dealer_id,attendance_id,status,assigned_at)
 SELECT s.game_table_id,s.id,club,dealer,attendance,'assigned',now() FROM public.table_sessions s WHERE s.id=sessions[1];
 INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb)
 ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 INSERT INTO public.tracker_voice_configs(club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,control_epoch,enabled,configured_mode)
 SELECT club,final,selected[1],s.game_table_id,s.id,s.control_epoch,true,'assist'
 FROM public.table_sessions s WHERE s.id=sessions[1];
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3(final,selected[1],sessions[1],epoch,1,now(),actor,1);
 ASSERT r->>'status'='success',r::text;
 h:=(r->>'hand_id')::uuid;
 preview:=public.get_tracker_hand_input_tables_v4(final);
 snap:=public.get_tracker_roster_snapshot_v2(final,selected[1],sessions[1],epoch);
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=2;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'post_sb',1,(seat_result->>'entry_number')::integer,'preflop',100);
 ASSERT r->>'status'='success',r::text;
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=3;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'post_bb',2,(seat_result->>'entry_number')::integer,'preflop',200);
 ASSERT r->>'status'='success',r::text;
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=1;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'all_in',3,(seat_result->>'entry_number')::integer,'preflop',40000);
 ASSERT r->>'status'='success',r::text;
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=2;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'all_in',4,(seat_result->>'entry_number')::integer,'preflop',39900);
 ASSERT r->>'status'='success',r::text;
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=3;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'all_in',5,(seat_result->>'entry_number')::integer,'preflop',39800);
 ASSERT r->>'status'='success',r::text;
 reg:=public.get_tracker_voice_validation_snapshot(final,selected[1],h);
 ASSERT reg->>'ok'='true',reg::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=3 AND sum(starting_stack)=120000 FROM public.hand_players WHERE hand_id=h),'D2 hand snapshot mismatch';
 ASSERT (SELECT count(*)=5 FROM public.hand_actions WHERE hand_id=h),'D2 action chain mismatch';
 ASSERT (SELECT status='in_progress' FROM public.tournament_hands WHERE id=h),'hand unexpectedly closed';
 ASSERT (SELECT count(*)=8 AND sum(current_stack)=320000 FROM public.tournament_entries WHERE tournament_id=final),'D2 current chips changed at Start';
 PERFORM set_config('local920.result',jsonb_build_object('event',event,'final',final,'flights',flights,
   'qualified',8,'initiallyUnseated',8,'planAssignments',jsonb_array_length(plan->'assignments'),
   'seatReceipts',jsonb_array_length(applied->'seatReceipts'),'cashMovements',
   (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=ANY(flights)),
   'carryStacks',(SELECT sum(carried_stack) FROM public.multi_day_final_participations_v1 WHERE event_id=event),
   'redrawBeforeContinue',state,'continue',recorded,'handId',h,'handPlayers',
   (SELECT count(*) FROM public.hand_players WHERE hand_id=h),'handActions',
   (SELECT count(*) FROM public.hand_actions WHERE hand_id=h),'actionSummary',
   (SELECT jsonb_agg(jsonb_build_object('order',action_order,'type',action_type,'amount',action_amount) ORDER BY action_order)
    FROM public.hand_actions WHERE hand_id=h),'handStatus',
   (SELECT status FROM public.tournament_hands WHERE id=h),'trackerContext',preview,'trackerRoster',snap,'trackerVoiceSnapshot',reg,
   'hand',(SELECT to_jsonb(th) FROM public.tournament_hands th WHERE th.id=h),
   'players',(SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.seat_number) FROM public.hand_players hp WHERE hp.hand_id=h))::text,true);
END $$;
SELECT current_setting('local920.result')::jsonb;
ROLLBACK;
DO $$BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'protected facts changed';END $$;
SELECT jsonb_build_object('protectedUnchanged',true,'tables',41);
`;
const boundary=sql.lastIndexOf('\nROLLBACK;\n');
assert.ok(boundary>0,'rollback boundary missing');
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let pending=null,buffer='',stderr='';
child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});
child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
 buffer+=chunk;
 while(buffer.includes('\n')){
  const cut=buffer.indexOf('\n'),line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+1);
  if(!pending)continue;
  if(line===pending.marker){const done=pending;pending=null;done.resolve(done.lines);}
  else if(line)pending.lines.push(line);
 }
});
child.on('exit',code=>{if(pending){const done=pending;pending=null;done.reject(new Error(`psql exited ${code}: ${stderr}`));}});
const send=statement=>new Promise((resolve,reject)=>{
 assert.equal(pending,null,'overlapping psql requests');
 const marker=`VINPOKER_919_${randomUUID().replaceAll('-','')}`;
 pending={marker,lines:[],resolve,reject};
 child.stdin.write(`${statement}\n\\echo ${marker}\n`);
});
const onlyJson=lines=>{
 const rows=lines.filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 assert.ok(rows.length>=1,JSON.stringify(lines));return rows.at(-1);
};
const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
let stage,receipt,retry,verification,bustEvidence,rankingSource,partialRankingGuard,history,claim,historicalSnapshot,historicalReceipt,verifiedHistory;
let redrawPlan,redrawApply,redrawPublic,redrawContinue,redrawFinal,terminalContext,terminalStart,terminalHand,terminalVoice,terminalSettlement,terminalFinish,terminalFinishRetry,terminalFacts,terminalRanking;
let prematureFinalize,rankingReview,rankingReviewRetry,rankingFinalize,finalizedFacts,final;
try{
 stage=onlyJson(await send(sql.slice(0,boundary)));
 let voice=stage.trackerVoiceSnapshot;
 const hand=stage.hand;
 assert.equal(voice.ok,true);
 const cardsBySeat={1:['As','Ah'],2:['Ks','Kh'],3:['Qs','Qh']};
 for(const player of stage.players){
  const ownerClaims=JSON.stringify({role:'authenticated',sub:hand.created_by});
  voice=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaims}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);\nSELECT public.get_tracker_voice_validation_snapshot('${stage.final}','${stage.trackerContext.tables[0].tournament_table_id}','${hand.id}');`));
  const cardKey=`d2-920-hole-${randomUUID()}`;
  const cardReceipt=onlyJson(await send(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT set_config('role','service_role',true);\nSELECT public.commit_tracker_voice_hole_cards_v0('${hand.created_by}','${stage.final}','${stage.trackerContext.tables[0].tournament_table_id}','${hand.id}',
   'openai_realtime','gpt-live-transcribe','${cardKey}','${voice.state_version}','${cardKey}','d2-920-local-hole',${player.seat_number},${quote(cardsBySeat[player.seat_number])});`));
  assert.equal(cardReceipt.ok,true,JSON.stringify(cardReceipt));
 }
 const board=['2c','3d','7h','8s','9c'];
 const ownerClaims=JSON.stringify({role:'authenticated',sub:hand.created_by});
 const boardReceipt=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaims}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);\nSELECT public.update_community_cards('${hand.id}',${quote(board)},'${hand.created_by}');`));
 assert.equal(boardReceipt.status,'success',JSON.stringify(boardReceipt));
 voice=onlyJson(await send(`SELECT public.get_tracker_voice_validation_snapshot('${stage.final}','${stage.trackerContext.tables[0].tournament_table_id}','${hand.id}');`));
 const populatedPlayers=onlyJson(await send(`SELECT jsonb_build_object('players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seat_number) FROM public.hand_players p WHERE p.hand_id='${hand.id}'));`)).players;
 const runtime=reduceHand(voice.players,voice.actions,voice.button_seat);
 const settlement=await computeVoiceFinishSettlement({handId:hand.id,stateVersion:voice.state_version,buttonSeat:voice.button_seat,
  communityCards:voice.community_cards,players:populatedPlayers,actions:voice.actions,bettingComplete:isBettingRoundComplete(runtime)});
 assert.equal(settlement.settlementOrigin,'engine_showdown');
 assert.equal(settlement.summary.conservation_total,120000);
 const record={hand_number:hand.hand_number,hand_time:hand.created_at,players:settlement.recordPlayers,actions:settlement.recordActions,
  side_pots:settlement.sidePots,community_cards:voice.community_cards,pot_size:settlement.potSize};
 const key=`d2-920-finish-${randomUUID()}`;
 const finish=`SELECT public.commit_tracker_voice_finish_v0('${hand.created_by}','${stage.final}','${voice.tournament_table_id}','${hand.id}',
  'openai_realtime','gpt-live-transcribe','${key}','ket thuc hand','${voice.state_version}','${key}','d2-920-local-finish',
  '${settlement.settlementOrigin}','${settlement.settlementDigest}',${quote(record)});`;
 receipt=onlyJson(await send(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT set_config('role','service_role',true);\n${finish}`));
 assert.equal(receipt.ok,true,JSON.stringify(receipt));
 retry=onlyJson(await send(finish));
 assert.equal(retry.ok,true,JSON.stringify(retry));
 verification=onlyJson(await send(`SELECT set_config('role','none',true);\nSELECT jsonb_build_object(
  'handStatus',(SELECT status FROM public.tournament_hands WHERE id='${hand.id}'),
  'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${stage.final}' AND is_active),
  'seatChips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${stage.final}' AND is_active),
  'entryChips',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${stage.final}'),
  'eliminations',(SELECT count(*) FROM public.tournament_eliminations WHERE hand_id='${hand.id}'),
  'endingStacks',(SELECT jsonb_agg(jsonb_build_object('player_id',p.player_id,'entry_number',p.entry_number,
   'seat',s.chip_count,'entry',e.current_stack) ORDER BY p.seat_number)
   FROM public.hand_players p JOIN public.tournament_seats s ON s.tournament_id='${stage.final}' AND s.player_id=p.player_id AND s.is_active
   JOIN public.tournament_entries e ON e.tournament_id='${stage.final}' AND e.player_id=p.player_id AND e.entry_no=p.entry_number
   WHERE p.hand_id='${hand.id}'));`));
 assert.equal(verification.handStatus,'completed');
 assert.equal(verification.activeSeats,6);assert.equal(verification.seatChips,320000);assert.equal(verification.entryChips,320000);
 assert.equal(verification.eliminations,2);
 for(const expected of settlement.recordPlayers){
  const actual=verification.endingStacks?.find(row=>row.player_id===expected.player_id&&row.entry_number===expected.entry_number);
  if(expected.ending_stack>0){assert.equal(actual?.seat,expected.ending_stack);assert.equal(actual?.entry,expected.ending_stack);}
 }
 bustEvidence=onlyJson(await send(`SELECT jsonb_build_object('entries',
  (SELECT jsonb_agg(jsonb_build_object('entry_id',e.id,'player_id',e.player_id,'entry_number',e.entry_no,'status',e.status,
   'current_stack',e.current_stack,'finished_place',e.finished_place) ORDER BY p.seat_number)
   FROM public.hand_players p JOIN public.tournament_entries e ON e.tournament_id='${stage.final}'
    AND e.player_id=p.player_id AND e.entry_no=p.entry_number WHERE p.hand_id='${hand.id}'),
  'eliminations',(SELECT jsonb_agg(to_jsonb(x)) FROM public.tournament_eliminations x WHERE x.hand_id='${hand.id}'));`));
 assert.equal(bustEvidence.entries.filter(row=>row.status==='busted'&&row.current_stack===0&&row.finished_place===null).length,2,JSON.stringify(bustEvidence));
 assert.equal(bustEvidence.eliminations.length,2);
 rankingSource=onlyJson(await send(`SELECT floor_private.tournament_ranking_source296('${stage.final}');`));
 assert.equal(rankingSource.requiresReview,true);assert.equal(rankingSource.evidencePending,false);
 assert.equal(rankingSource.missingOrders,0);assert.equal(rankingSource.survivors,6);
 assert.deepEqual(rankingSource.simultaneousGroups.map(group=>group.handId),[hand.id]);
 assert.deepEqual([...rankingSource.simultaneousGroups[0].entryIds].sort(),
  bustEvidence.entries.filter(row=>row.status==='busted').map(row=>row.entry_id).sort());
 const orderedIds=rankingSource.entries.map(entry=>entry.entryId);
 assert.ok(orderedIds.every(id=>/^[0-9a-f-]{36}$/.test(id)));
 const ownerClaimsForReview=JSON.stringify({role:'authenticated',sub:hand.created_by});
 partialRankingGuard=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaimsForReview}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);\nDO $$ DECLARE denied boolean:=false;BEGIN
  BEGIN
   PERFORM public.confirm_tournament_ranking_review_v1('${stage.final}','${rankingSource.sourceHash}',
    ARRAY[${orderedIds.map(id=>`'${id}'::uuid`).join(',')}],gen_random_uuid(),'${hand.created_by}');
  EXCEPTION WHEN OTHERS THEN
   ASSERT SQLERRM='ranking_review_not_ready',SQLERRM;denied:=true;
  END;
  ASSERT denied,'partial D2 ranking review unexpectedly accepted';
 END $$;\nSELECT set_config('role','none',true);\nSELECT jsonb_build_object(
  'reviewRows',(SELECT count(*) FROM floor_private.tournament_ranking_reviews296 WHERE tournament_id='${stage.final}'),
  'prizePayments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${stage.final}'),
  'closeReports',(SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='${stage.final}'),
  'officialPlaces',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${stage.final}' AND finished_place IS NOT NULL));`));
 assert.deepEqual(partialRankingGuard,{reviewRows:0,prizePayments:0,closeReports:0,officialPlaces:0});
 history=onlyJson(await send(`SELECT set_config('request.jwt.claims','{"role":"anon"}',true);\nSELECT set_config('role','anon',true);\nSELECT public.get_public_tournament_table_history_v2('${stage.final}','${voice.tournament_table_id}',20,NULL,NULL);`));
 assert.equal(history.access,'public',JSON.stringify(history));
 assert.ok(history.items.some(item=>item.handId===hand.id&&item.result?.status==='pending'),JSON.stringify(history));
 const claimLines=await send(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT set_config('role','service_role',true);\nSELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY['${hand.id}'::uuid],1) x;`);
 claim=JSON.parse(claimLines.find(line=>line.startsWith('['))??'null');
 assert.equal(claim?.length,1,JSON.stringify(claimLines));
 assert.equal(claim[0].hand_id,hand.id);
 historicalSnapshot=onlyJson(await send(`SELECT public.get_tracker_historical_display_snapshot('${hand.id}',NULL);`));
 const source=normalizeSettlementSourceRpcResult({source_revision:historicalSnapshot.sourceRevision,source_chain_hash:historicalSnapshot.sourceChainHash});
 assert.equal(source.sourceRevision,claim[0].source_revision);
 const outcome=await verifyHistoricalDisplaySettlement({tournamentId:stage.final,hand:historicalSnapshot.hand,players:historicalSnapshot.players,
  actions:historicalSnapshot.actions,sourceRevision:source.sourceRevision,sourceChainHash:source.sourceChainHash,
  settlementRevision:1,actor:{userId:'00000000-0000-4000-8000-000000000001',role:'system_worker'}});
 const historyKey=`history-worker:${hand.id}:${source.sourceRevision}:1:${outcome.privateOutcome.outcomeHash}`;
 const requestHash=createHash('sha256').update(canonicalJsonV1({contract:'historical-settlement-display-worker-v1',handId:hand.id,
  sourceRevision:source.sourceRevision,sourceChainHash:source.sourceChainHash,settlementRevision:1,outcomeHash:outcome.privateOutcome.outcomeHash})).digest('hex');
 historicalReceipt=onlyJson(await send(`SELECT public.commit_tracker_historical_display_outcome_v2('${hand.id}',
  '00000000-0000-4000-8000-000000000001','system_worker',${source.sourceRevision},'${source.sourceChainHash}',
  '${outcome.privateOutcome.outcomeHash}','${requestHash}','${historyKey}',${quote(outcome.publicOutcome)},'${claim[0].lease_token}');`));
 assert.equal(historicalReceipt.ok,true,JSON.stringify(historicalReceipt));
 verifiedHistory=onlyJson(await send(`SELECT set_config('request.jwt.claims','{"role":"anon"}',true);\nSELECT set_config('role','anon',true);\nSELECT public.get_public_tournament_table_history_v2('${stage.final}','${voice.tournament_table_id}',20,NULL,NULL);`));
 assert.ok(verifiedHistory.items.some(item=>item.handId===hand.id&&item.result?.status==='verified'),JSON.stringify(verifiedHistory));
 const ownerClaimsForRedraw=JSON.stringify({role:'authenticated',sub:hand.created_by});
 const targetPhysical=stage.trackerContext.tables[0].table_id;
 redrawPlan=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaimsForRedraw}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);\nSELECT public.floor_plan_tournament_redraw_v1('${stage.final}',9,ARRAY['${targetPhysical}'::uuid],'${randomUUID()}');`));
 assert.equal(redrawPlan.ok,true,JSON.stringify(redrawPlan));
 assert.equal(redrawPlan.player_count,6);assert.equal(redrawPlan.target_table_count,1);
 redrawApply=onlyJson(await send(`SELECT public.floor_apply_tournament_redraw_v1('${redrawPlan.batch_id}','${randomUUID()}');`));
 assert.equal(redrawApply.ok,true,JSON.stringify(redrawApply));
 redrawPublic=onlyJson(await send(`SELECT set_config('request.jwt.claims','{"role":"anon"}',true);\nSELECT set_config('role','anon',true);\nSELECT public.get_public_tournament_redraw_v1('${stage.final}');`));
 assert.equal(redrawPublic.moves?.length,6,JSON.stringify(redrawPublic));
 redrawContinue=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaimsForRedraw}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);\nSELECT public.floor_continue_tournament_redraw_v1('${redrawPlan.batch_id}',${redrawPublic.redraw_revision},'${randomUUID()}');`));
 assert.equal(redrawContinue.ok,true,JSON.stringify(redrawContinue));
 redrawFinal=onlyJson(await send(`SELECT set_config('role','none',true);\nSELECT jsonb_build_object(
  'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${stage.final}' AND is_active),
  'seatChips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${stage.final}' AND is_active),
  'entryChips',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${stage.final}'),
  'physicalTables',(SELECT jsonb_agg(DISTINCT tt.game_table_id) FROM public.tournament_seats s JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id
   WHERE s.tournament_id='${stage.final}' AND s.is_active),
  'savedSeats',(SELECT jsonb_agg(jsonb_build_object('entry_id',s.entry_id,'table_number',tt.table_number,'seat_number',s.seat_number) ORDER BY s.entry_id)
   FROM public.tournament_seats s JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id
   WHERE s.tournament_id='${stage.final}' AND s.is_active),
  'publicRedraw',(SELECT public.get_public_tournament_redraw_v1('${stage.final}')));`));
 assert.equal(redrawFinal.activeSeats,6);assert.equal(redrawFinal.seatChips,320000);assert.equal(redrawFinal.entryChips,320000);
 assert.deepEqual(redrawFinal.physicalTables,[targetPhysical]);
 assert.deepEqual(redrawApply.moves.map(move=>({entry_id:move.entry_id,table_number:move.to_table_number,seat_number:move.to_seat_number})).sort((a,b)=>a.entry_id.localeCompare(b.entry_id)),
  redrawFinal.savedSeats.sort((a,b)=>a.entry_id.localeCompare(b.entry_id)));
 assert.deepEqual(redrawPublic.moves.map(move=>`${move.to_table_number}:${move.to_seat_number}`).sort(),
  redrawFinal.savedSeats.map(seat=>`${seat.table_number}:${seat.seat_number}`).sort());
 assert.equal(redrawFinal.publicRedraw.batch_id,null);
 terminalContext=onlyJson(await send(`SELECT jsonb_build_object(
  'sessions',(SELECT jsonb_agg(jsonb_build_object('table_id',tt.id,'table_number',tt.table_number,'session_id',s.id,
   'physical_table_id',s.game_table_id,'mode',s.control_mode,'epoch',s.control_epoch,'revision',s.revision,'closed',s.closed_at IS NOT NULL))
   FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id
   WHERE tt.tournament_id='${stage.final}' AND tt.game_table_id='${targetPhysical}'),
  'players',(SELECT jsonb_agg(jsonb_build_object('player_id',x.player_id,'entry_number',x.entry_number,'seat_number',x.seat_number,
   'chip_count',x.chip_count) ORDER BY x.seat_number)
   FROM public.tournament_seats x WHERE x.tournament_id='${stage.final}' AND x.is_active));`));
 assert.equal(terminalContext.players.length,6);
 assert.equal(terminalContext.sessions.length,1);
 const terminalSession=terminalContext.sessions[0];
 assert.equal(terminalSession.mode,'tracker');assert.equal(terminalSession.closed,false);
 const ownerClaimsForTerminal=JSON.stringify({role:'authenticated',sub:hand.created_by});
 terminalStart=onlyJson(await send(`UPDATE public.tracker_voice_configs SET control_epoch=${terminalSession.epoch},enabled=true,configured_mode='assist'
  WHERE tournament_id='${stage.final}' AND tournament_table_id='${terminalSession.table_id}';
  SELECT set_config('request.jwt.claims','${ownerClaimsForTerminal}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);
  SELECT public.start_tracker_hand_v3('${stage.final}','${terminalSession.table_id}','${terminalSession.session_id}',${terminalSession.epoch},2,now(),'${hand.created_by}',1);`));
 assert.equal(terminalStart.status,'success',JSON.stringify(terminalStart));
 terminalHand=onlyJson(await send(`SELECT set_config('role','none',true);\nSELECT jsonb_build_object(
  'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id='${terminalStart.hand_id}'),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seat_number) FROM public.hand_players p WHERE p.hand_id='${terminalStart.hand_id}'));`));
 assert.equal(terminalHand.players.length,6);
 assert.equal(terminalHand.players.reduce((sum,p)=>sum+p.starting_stack,0),320000);
 const terminalPlayersBySeat=new Map(terminalHand.players.map(player=>[player.seat_number,player]));
 let terminalOrder=0;
 const terminalActions=[{seat:2,type:'post_sb',amount:100},{seat:3,type:'post_bb',amount:200},
  ...[4,5,6,1,2,3].map(seat=>({seat,type:'all_in',amount:terminalPlayersBySeat.get(seat).starting_stack-(seat===2?100:seat===3?200:0)}))];
 for(const action of terminalActions){
  const player=terminalPlayersBySeat.get(action.seat);
  const actionReceipt=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaimsForTerminal}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);
   SELECT public.record_action('${terminalStart.hand_id}','${player.player_id}','${action.type}',${++terminalOrder},${player.entry_number},'preflop',${action.amount});`));
  assert.equal(actionReceipt.status,'success',JSON.stringify(actionReceipt));
 }
 const bigStackSeat=[...terminalHand.players].sort((a,b)=>b.starting_stack-a.starting_stack)[0].seat_number;
 const otherCards=[['Ks','Kh'],['Qs','Qh'],['Js','Jh'],['Ts','Th'],['9s','9h']];
 const terminalCardsBySeat=Object.fromEntries(terminalHand.players.map(player=>[player.seat_number,
  player.seat_number===bigStackSeat?['As','Ah']:otherCards.shift()]));
 for(const player of terminalHand.players){
  terminalVoice=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaimsForTerminal}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);
   SELECT public.get_tracker_voice_validation_snapshot('${stage.final}','${terminalSession.table_id}','${terminalStart.hand_id}');`));
  assert.equal(terminalVoice.ok,true,JSON.stringify(terminalVoice));
  const cardKey=`d2-922-hole-${randomUUID()}`;
  const cardReceipt=onlyJson(await send(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT set_config('role','service_role',true);
   SELECT public.commit_tracker_voice_hole_cards_v0('${hand.created_by}','${stage.final}','${terminalSession.table_id}','${terminalStart.hand_id}',
    'openai_realtime','gpt-live-transcribe','${cardKey}','${terminalVoice.state_version}','${cardKey}','d2-922-local-hole',${player.seat_number},${quote(terminalCardsBySeat[player.seat_number])});`));
  assert.equal(cardReceipt.ok,true,JSON.stringify(cardReceipt));
 }
 const terminalBoard=['2c','3d','7h','8s','4c'];
 const terminalBoardReceipt=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaimsForTerminal}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);
  SELECT public.update_community_cards('${terminalStart.hand_id}',${quote(terminalBoard)},'${hand.created_by}');`));
 assert.equal(terminalBoardReceipt.status,'success',JSON.stringify(terminalBoardReceipt));
 terminalVoice=onlyJson(await send(`SELECT public.get_tracker_voice_validation_snapshot('${stage.final}','${terminalSession.table_id}','${terminalStart.hand_id}');`));
 const terminalPopulated=onlyJson(await send(`SELECT jsonb_build_object('players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seat_number)
  FROM public.hand_players p WHERE p.hand_id='${terminalStart.hand_id}'));`)).players;
 const terminalRuntime=reduceHand(terminalVoice.players,terminalVoice.actions,terminalVoice.button_seat);
 terminalSettlement=await computeVoiceFinishSettlement({handId:terminalStart.hand_id,stateVersion:terminalVoice.state_version,buttonSeat:terminalVoice.button_seat,
  communityCards:terminalVoice.community_cards,players:terminalPopulated,actions:terminalVoice.actions,bettingComplete:isBettingRoundComplete(terminalRuntime)});
 assert.equal(terminalSettlement.settlementOrigin,'engine_showdown');
 assert.equal(terminalSettlement.summary.conservation_total,320000);
 assert.equal(terminalSettlement.recordPlayers.filter(p=>p.is_eliminated).length,5,JSON.stringify(terminalSettlement));
 assert.equal(terminalSettlement.recordPlayers.find(p=>p.seat_number===bigStackSeat).ending_stack,320000);
 const terminalRecord={hand_number:terminalHand.hand.hand_number,hand_time:terminalHand.hand.created_at,players:terminalSettlement.recordPlayers,
  actions:terminalSettlement.recordActions,side_pots:terminalSettlement.sidePots,community_cards:terminalVoice.community_cards,pot_size:terminalSettlement.potSize};
 const terminalKey=`d2-922-finish-${randomUUID()}`;
 const terminalFinishSql=`SELECT public.commit_tracker_voice_finish_v0('${hand.created_by}','${stage.final}','${terminalSession.table_id}','${terminalStart.hand_id}',
  'openai_realtime','gpt-live-transcribe','${terminalKey}','ket thuc hand','${terminalVoice.state_version}','${terminalKey}','d2-922-local-finish',
  '${terminalSettlement.settlementOrigin}','${terminalSettlement.settlementDigest}',${quote(terminalRecord)});`;
 terminalFinish=onlyJson(await send(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT set_config('role','service_role',true);\n${terminalFinishSql}`));
 assert.equal(terminalFinish.ok,true,JSON.stringify(terminalFinish));
 terminalFinishRetry=onlyJson(await send(terminalFinishSql));
 assert.equal(terminalFinishRetry.duplicate,true,JSON.stringify(terminalFinishRetry));
 terminalFacts=onlyJson(await send(`SELECT set_config('role','none',true);\nSELECT jsonb_build_object(
  'completed',(SELECT status FROM public.tournament_hands WHERE id='${terminalStart.hand_id}'),
  'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${stage.final}' AND is_active),
  'seatChips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${stage.final}' AND is_active),
  'entryChips',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${stage.final}'),
  'handEliminations',(SELECT count(*) FROM public.tournament_eliminations WHERE hand_id='${terminalStart.hand_id}'),
  'totalBusted',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${stage.final}' AND status='busted'),
  'officialPlaces',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${stage.final}' AND finished_place IS NOT NULL));`));
 assert.deepEqual(terminalFacts,{completed:'completed',activeSeats:1,seatChips:320000,entryChips:320000,handEliminations:5,totalBusted:7,officialPlaces:0});
 terminalRanking=onlyJson(await send(`SELECT floor_private.tournament_ranking_source296('${stage.final}');`));
 assert.equal(terminalRanking.survivors,1);
 assert.equal(terminalRanking.missingOrders,0);
 prematureFinalize=onlyJson(await send(`SELECT public.finalize_tournament_results('${stage.final}');`));
 assert.equal(prematureFinalize.error,'manual_ranking_review_required',JSON.stringify(prematureFinalize));
 const rankingIds=terminalRanking.entries.map(entry=>entry.entryId);
 const terminalGroup=terminalRanking.simultaneousGroups.find(group=>group.entryIds.length===5);
 assert.ok(terminalGroup);
 const groupPositions=rankingIds.map((id,index)=>terminalGroup.entryIds.includes(id)?index:-1).filter(index=>index>=0);
 assert.equal(groupPositions.length,5);
 [rankingIds[groupPositions[0]],rankingIds[groupPositions[1]]]=[rankingIds[groupPositions[1]],rankingIds[groupPositions[0]]];
 const rankingRequest=randomUUID();
 const reviewSql=`SELECT public.confirm_tournament_ranking_review_v1('${stage.final}','${terminalRanking.sourceHash}',
  ARRAY[${rankingIds.map(id=>`'${id}'::uuid`).join(',')}],'${rankingRequest}','${hand.created_by}');`;
 rankingReview=onlyJson(await send(`SELECT set_config('request.jwt.claims','${ownerClaimsForTerminal}',true);\nSELECT set_config('request.jwt.claim.sub','${hand.created_by}',true);\nSELECT set_config('role','authenticated',true);\n${reviewSql}`));
 assert.equal(rankingReview.outcome,'recorded',JSON.stringify(rankingReview));
 rankingReviewRetry=onlyJson(await send(reviewSql));
 assert.deepEqual(rankingReviewRetry,rankingReview);
 rankingFinalize=onlyJson(await send(`SELECT set_config('role','none',true);\nSELECT public.finalize_tournament_results('${stage.final}');`));
 assert.equal(rankingFinalize.ranking_review,true,JSON.stringify(rankingFinalize));
 finalizedFacts=onlyJson(await send(`SELECT jsonb_build_object(
  'places',(SELECT jsonb_agg(jsonb_build_object('entry_id',id,'place',finished_place) ORDER BY finished_place) FROM public.tournament_entries WHERE tournament_id='${stage.final}' AND finished_place IS NOT NULL),
  'payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${stage.final}'),
  'closeReports',(SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='${stage.final}')) ;`));
 assert.deepEqual(finalizedFacts.places.map(row=>row.entry_id),rankingIds);
 assert.deepEqual(finalizedFacts.places.map(row=>row.place),[1,2,3,4,5,6,7,8]);
 final=onlyJson(await send(sql.slice(boundary)));
 assert.equal(final.protectedUnchanged,true);
 writeFileSync('D:/Quy trình/output/reports/d2_923-floor-ranking-native-local-20261026.json',JSON.stringify({stage:{event:stage.event,final:stage.final,handId:hand.id,qualified:stage.qualified,seatReceipts:stage.seatReceipts,handActions:stage.handActions},
  settlement:{origin:settlement.settlementOrigin,summary:settlement.summary,recordPlayers:settlement.recordPlayers},receipt,retry,verification,bustEvidence,rankingSource,partialRankingGuard,history,claim,
  historicalSnapshot:{sourceRevision:historicalSnapshot.sourceRevision,sourceChainHash:historicalSnapshot.sourceChainHash},historicalReceipt,verifiedHistory,
  redrawPlan,redrawApply,redrawPublic,redrawContinue,redrawFinal,terminalContext,terminalStart,terminalHand,
  terminalSettlement:{origin:terminalSettlement.settlementOrigin,summary:terminalSettlement.summary,recordPlayers:terminalSettlement.recordPlayers},
  terminalFinish,terminalFinishRetry,terminalFacts,terminalRanking,prematureFinalize,rankingReview,rankingReviewRetry,rankingFinalize,finalizedFacts,final},null,2)+'\n');
 console.log('D2_923_FLOOR_RANKING_ROLLBACK_PASS',JSON.stringify({survivors:terminalFacts.activeSeats,places:finalizedFacts.places.length,review:rankingReview.outcome,protectedUnchanged:final.protectedUnchanged}));
}finally{
 child.stdin.end();
}

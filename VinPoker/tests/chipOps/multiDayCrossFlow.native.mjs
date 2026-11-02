import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';
import {parseD2Roster,parseD2Plan,parseD2Application} from '../../src/ops/floor/multiDayInitialDraw.ts';

assert.equal(process.env.VINPOKER_NATIVE_CROSS_FLOW,'1');
const reusePool=process.argv.includes('--reuse-existing-pool');
if(reusePool)assert.ok(process.argv.includes('--prepare-bagging-browser'),'explicit fresh preparation only; never change an existing journey');
if(process.argv.includes('--payout-journey'))assert.ok(['--multiplayer','--initial-plan','--initial-apply','--initial-tv'].every(flag=>process.argv.includes(flag)));
if(process.argv.includes('--d2-hand')) {
 assert.ok(['--multiplayer','--initial-plan','--initial-apply','--initial-tv'].every(flag=>process.argv.includes(flag)),
  'D2 hand requires the full multiplayer initial draw/TV continuation');
 assert.ok(!process.argv.includes('--prepare-browser'),'prepare-only cannot claim D2 hand execution');
}
const retainedCommit846=process.argv.includes('--retained-seed-commit846');
const database=retainedCommit846?'vinpoker_checkout814_race_local':'vinpoker_ops_cash115_qualified_c';
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database})) assert.equal(process.env[key],value);
const prefix=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql'];
const sql=query=>execFileSync('wsl',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000}).trim();
function session(name) {
 const child=spawn('wsl',[...prefix.slice(0,-1),`PGAPPNAME=${name}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],timeout:30000});
 let output='',errors='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{errors+=data;});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(errors)));});
 void closed.catch(()=>{});return {child,closed,output:()=>output};
}
async function until(check) {
 const end=Date.now()+10000;
 while(!check()){assert.ok(Date.now()<end,'D2 concurrency barrier timeout');await new Promise(resolve=>setTimeout(resolve,30));}
}
const resumeEvent=process.env.VINPOKER_RESUME_BAG_EVENT;
if(retainedCommit846){
 assert.equal(process.argv.length,3,'owned-clone commit mode must not mix with constructors');
 const {verifyRetainedSeed846Commit}=await import('./d2Seed846.commit.local.mjs');
 await verifyRetainedSeed846Commit({sql,session,until});
 process.exit(0);
}
if(process.argv.includes('--retained-seed-overlap845')){
 assert.equal(process.argv.length,3,'retained rollback mode must not mix with fixture constructors');
 const {verifyRetainedSeed845Overlap}=await import('./d2Seed845.overlap.local.mjs');
 await verifyRetainedSeed845Overlap({sql,session,until});
 process.exit(0);
}
let resumed=null;
if(resumeEvent) {
 assert.match(resumeEvent,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
 assert.ok(process.argv.includes('--prepare-bagging-browser'),'resume only prepares a second flight for browser, never locks qualification');
 resumed=JSON.parse(sql(`SELECT jsonb_build_object('event',e.id,'final',e.final_tournament_id,'club',e.club_id,'actor',c.owner_id,
   'firstFlight',t.id,'players',(SELECT jsonb_agg(r.player_id ORDER BY r.player_id) FROM public.multi_day_flight_roster_v1 r WHERE r.flight_tournament_id=t.id))
   FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id JOIN public.tournaments t ON t.event_id=e.id AND t.phase='flight'
   JOIN public.day_close d ON d.tournament_id=t.id AND d.status='locked'
   WHERE e.id='${resumeEvent}' AND e.name='Multi-day SELECT_LARGEST local TEST' AND c.name='Cash identity local TEST';`));
 assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE event_id='${resumeEvent}' AND phase='flight';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.multi_day_qualification_locks_v1 WHERE event_id='${resumeEvent}';`),'0');
 assert.equal(resumed.players.length,8);
 resumed.bagsBefore=sql(`SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text) FROM public.chip_bag b WHERE b.tournament_id='${resumed.firstFlight}';`);
}
policyLoop: for(const policy of (process.argv.includes('--prepare-bagging-browser')?['SELECT_LARGEST']:['SELECT_LARGEST','SUM_STACKS'])) {
 const f=resumed?{actor:resumed.actor,club:resumed.club,player:resumed.players[0]}:createPaidJourneyFixture(sql,{playerHistoryEnabled:process.argv.includes('--payout-journey'),reuseExistingPool714:reusePool});
 const event=resumed?.event??randomUUID(),final=resumed?.final??randomUUID(),flights=resumed?[randomUUID()]:[randomUUID(),randomUUID()];
 const players=resumed?.players??[f.player,...(process.argv.includes('--multiplayer')?Array.from({length:7},()=>randomUUID()):[])];
 if(!resumed&&players.length>1)sql(`INSERT INTO auth.users(id) VALUES ${players.slice(1).map(id=>`('${id}')`).join(',')};`);
 const actor=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const call=query=>JSON.parse(sql(`BEGIN;${actor}${query}COMMIT;`));
 const gateBefore=sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb)::text FROM public.multi_day_package_release_v1 g;");
 const opsGateBefore=JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.centerpoint_tournament_ops_release g;"));
 try {
  if(process.argv.includes('--initial-apply'))sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${f.club}'::uuid] WHERE id;`);
  // Synthetic metadata; all payment/bag/qualification/seating mutations below
  // use the actual RPCs. No denomination inventory or financial source is faked.
  if(!resumed)sql(`INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,buy_in,starting_stack)
  VALUES('${final}','${f.club}','Multi-day Final local TEST','active','registering','final',100000,20000);
  INSERT INTO public.tournament_events(id,club_id,name,final_tournament_id,itm_percent,buy_in,rake_amount)
  VALUES('${event}','${f.club}','Multi-day ${policy} local TEST','${final}',${process.argv.includes('--payout-journey')?25:100},100000,0);
  UPDATE public.tournaments SET event_id='${event}' WHERE id='${final}';`);
  if(process.argv.includes('--payout-journey')){
   assert.ok(!resumed,'never edit a resumed frozen prize table');
   // Fixture prizes must exist BEFORE rules/registrations/flight-end fences.
   sql(`INSERT INTO public.tournament_prizes(tournament_id,position,percentage,amount)
    SELECT '${final}',n,25,${policy==='SELECT_LARGEST'?100000:300000} FROM generate_series(1,4) n;`);
  }
  sql(`INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids) VALUES(true,true,ARRAY['${f.club}'::uuid])
  ON CONFLICT(id) DO UPDATE SET enabled=true,allowed_club_ids=excluded.allowed_club_ids;`);
  call(`SELECT public.multi_day_set_qualification_rules_v2('${event}','${policy}',1,100);`);
  for(const [position,flight] of flights.entries()) {
   const index=position+(resumed?1:0);
   const physical=reusePool?sql(`SELECT id FROM public.game_tables WHERE club_id='${f.club}' AND table_number=${index+10} AND status='inactive' AND operational_status='available';`):randomUUID(),dealer=randomUUID(),attendance=randomUUID(),shift=randomUUID();
   assert.match(physical,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
   sql(`INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,flight_label,event_id,buy_in,starting_stack)
   VALUES('${flight}','${f.club}','Multi-day Flight ${index} local TEST','active','registering','flight','${index}','${event}',100000,20000);
   ${reusePool?'':`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
   VALUES('${physical}','${f.club}','Multi-day local TEST ${index}',${index+10},'tournament','inactive','available');`}`);
   const opened=call(`SELECT public.floor_open_tournament_table_v3('${flight}','${physical}','manual','${randomUUID()}');`);assert.equal(opened.ok,true);
   for(const player of players) {
   const registration=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
   SELECT public.cashier_create_app_registration_v1('${flight}','${player}');COMMIT;`));assert.equal(registration.ok,true);
   const paid=call(`SELECT public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id','${f.actor}','club_id','${f.club}',
   'tournament_id','${flight}','registration_id','${registration.registration_id}','amount',100000,'request_id','${randomUUID()}'),'record');`);
   assert.equal(paid.status,'recorded');assert.equal(paid.result.seating_state,'seated');
   }
   const context=JSON.parse(sql(`SELECT jsonb_build_object('table',tt.id,'session',s.id,'epoch',s.control_epoch,'revision',s.revision)
   FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id WHERE tt.tournament_id='${flight}';`));
   assert.equal(call(`SELECT public.floor_request_table_control_mode_v4('${context.table}','${context.session}','tracker',${context.revision},${context.epoch},'${randomUUID()}');`).ok,true);
   const epoch=Number(sql(`SELECT control_epoch FROM public.table_sessions WHERE id='${context.session}';`));
   for(const player of players) {
   const snapshot=call(`SELECT public.get_tracker_roster_snapshot_v2('${flight}','${context.table}','${context.session}',${epoch});`);
   const rosterSeat=snapshot.seats.find(row=>row.seat?.player_id===player);assert.ok(rosterSeat);
   const setup=call(`SELECT public.set_tracker_table_roster_seat_v2(p_tournament_id=>'${flight}',p_tournament_table_id=>'${context.table}',
   p_table_session_id=>'${context.session}',p_expected_epoch=>${epoch},p_seat_number=>${rosterSeat.seat_number},
   p_player_name=>'Multi-day paid local TEST',p_chip_count=>20000,p_existing_player_id=>'${player}',p_touch_avatar=>false,p_avatar_url=>NULL,
   p_expected_seat_token=>'${rosterSeat.token}',p_request_id=>'${randomUUID()}');`);assert.equal(setup.ok,true);
   }
   // Assignment is a fixture precondition, not an Auto Swing acceptance claim.
   sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';
   SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${f.actor}"}';
   INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${f.club}','Multi-day local TEST','00:00','23:59');
   INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealer}','${f.club}','Multi-day local TEST','active');
   INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
   VALUES('${attendance}','${dealer}','${shift}',${reusePool?"(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date":'current_date'},'checked_in',now(),'assigned');
   INSERT INTO public.dealer_assignments(table_id,table_session_id,club_id,dealer_id,attendance_id,status,assigned_at)
   SELECT '${physical}',table_session_id,'${f.club}','${dealer}','${attendance}','assigned',now() FROM public.tournament_tables WHERE tournament_id='${flight}';COMMIT;`);
   const cashBefore=sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM public.cashier_buyin_movements m WHERE tournament_id='${flight}';`);
   const ended=call(`SELECT public.multi_day_end_flight_v1('${flight}',${index+1},'${randomUUID()}');`);assert.equal(ended.ok,true);
   let state=call(`SELECT public.multi_day_bagging_state_v1('${flight}');`);
   assert.equal(state.rows.length,players.length);assert.ok(state.rows.every(row=>row.trackedStack===20000));
   if(process.argv.includes('--prepare-bagging-browser')) {
    console.log('BAGGING_BROWSER_MANIFEST',JSON.stringify({event,final,flight,club:f.club,actor:f.actor,players,policy}));
    if(resumed)assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text) FROM public.chip_bag b WHERE b.tournament_id='${resumed.firstFlight}';`),resumed.bagsBefore,'first browser bags must remain unchanged');
    continue policyLoop;
   }
   for(const [playerIndex,player] of players.entries()) {
   const recordId=randomUUID(),recordQuery=`SELECT public.multi_day_record_bag_v1('${flight}','${player}','BAG-${index}-${playerIndex}',20000,0,'${recordId}');`;
   const recorded=call(recordQuery);assert.equal(recorded.ok,true);assert.equal(call(recordQuery).idempotent,true);
   const sealed=call(`SELECT public.multi_day_seal_bag_v1('${flight}','${player}',${recorded.revision},'${randomUUID()}');`);assert.equal(sealed.sealed,true);
   }
   state=call(`SELECT public.multi_day_bagging_state_v1('${flight}');`);
   assert.equal(state.rows[0].bagTotal,20000);assert.equal(state.rows[0].sealed,true);
   assert.equal(call(`SELECT public.multi_day_close_bagging_v1('${flight}',${state.dayVersion},'${randomUUID()}');`).ok,true);
   assert.equal(sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM public.cashier_buyin_movements m WHERE tournament_id='${flight}';`),cashBefore,'bagging must not charge another buy-in');
  }
  const preview=call(`SELECT public.multi_day_qualification_preview_v1('${event}');`);
  assert.equal(preview.flights.length,2);const bags=preview.flights.flatMap(flight=>flight.eligibleBags.map(bag=>bag.bagId));assert.equal(bags.length,players.length*2);
  const locked=call(`SELECT public.multi_day_lock_qualification_v1('${event}',ARRAY[${bags.map(id=>`'${id}'::uuid`).join(',')}],'${preview.sourceHash}','${randomUUID()}');`);
  assert.equal(locked.ok,true);
  const expected=policy==='SUM_STACKS'?40000:20000;
  assert.equal(Number(sql(`SELECT carried_stack FROM public.multi_day_final_participations_v1 WHERE event_id='${event}' AND player_id='${f.player}';`)),expected);
  const readD2=()=>parseD2Roster(call(`SELECT public.multi_day_final_roster_v1('${event}');`),event);
  if(process.argv.includes('--d2-read')) {
   const roster=readD2();
   assert.equal(roster.eventId,event);assert.equal(roster.finalTournamentId,final);
   assert.equal(roster.releaseEnabled,true);assert.match(roster.sourceHash,/^[a-f0-9]{32}$/);
   assert.equal(roster.players.length,1);assert.equal(roster.players[0].state,'UNSEATED');
   assert.equal(roster.players[0].playerId,f.player);assert.equal(roster.players[0].name,'Multi-day paid local TEST');
   assert.equal(roster.players[0].stack,expected);assert.equal(roster.players[0].seedRevision,0);
   // Both policies preserve all selected source bags; SELECT_LARGEST chooses
   // carry value separately and retains nonselected minimum-cash provenance.
   assert.equal(roster.players[0].sourceBags.length,2);
   assert.equal(roster.tables.length,0);
  }
  const physical=randomUUID();sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
  VALUES('${physical}','${f.club}','Multi-day final local TEST',20,'tournament','inactive','available');`);
  assert.equal(call(`SELECT public.floor_open_tournament_table_v3('${final}','${physical}','manual','${randomUUID()}');`).ok,true);
  const table=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${final}';`);
  if(process.argv.includes('--initial-plan')) {
   const selected=[table];
   for(const number of [21,22]) {
    const id=randomUUID();
    sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
      VALUES('${id}','${f.club}','D2 chosen table ${number} TEST',${number},'tournament','inactive','available');`);
    const opened=call(`SELECT public.floor_open_tournament_table_v3('${final}','${id}','manual','${randomUUID()}');`);
    assert.equal(opened.ok,true);
    selected.push(sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${final}' AND game_table_id='${id}';`));
   }
   if(process.argv.includes('--initial-tv')) {
    sql(`INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
      VALUES('${final}',1,100,200,0,20,false);`);
    const started=call(`SELECT public.floor_start_tournament_clock('${final}');`);
    assert.equal(started.ok,true,JSON.stringify(started));
   }
   const clockState=()=>JSON.parse(sql(`SELECT jsonb_build_object('started',clock_started_at,'paused',clock_paused_at,
     'accumulated',pause_accumulated,'level',current_level,'revision',clock_control_revision)
     FROM public.tournaments WHERE id='${final}';`));
   const clockBefore=process.argv.includes('--initial-tv')?clockState():null;
   const source=readD2(),key=randomUUID();
   if(process.argv.includes('--prepare-browser')) {
    console.log('D2_BROWSER_MANIFEST',JSON.stringify({event,final,club:f.club,actor:f.actor,players,selectedTables:selected,policy}));
    continue;
   }
   const ids=selected.map(id=>`'${id}'::uuid`).join(',');
   const planQuery=`SELECT public.multi_day_plan_initial_draw_v1('${event}',ARRAY[${ids}],'${source.sourceHash}','${key}');`;
   const plan=parseD2Plan(call(planQuery),source,selected);assert.equal(plan.state,'PLANNED');assert.equal(plan.assignments.length,players.length);
   assert.ok(plan.assignments.some(row=>row.playerId===f.player));assert.ok(plan.assignments.every(row=>row.stack===expected));
   assert.equal(new Set(plan.assignments.map(row=>row.playerId)).size,players.length);
   assert.equal(plan.selectedTables.length,3);
   assert.deepEqual(plan.selectedTables.map(t=>t.tournamentTableId).sort(),selected.sort());
   assert.deepEqual(call(planQuery).assignments,plan.assignments,'preview retry must not reshuffle');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0','preview must not seat');
   assert.deepEqual(call(`SELECT public.multi_day_get_initial_draw_plan_v1('${event}','${key}');`).plan,plan,'lost preview response recovers exact immutable plan');
   assert.throws(()=>call(`SELECT public.multi_day_plan_initial_draw_v1('${event}',ARRAY['${table}'::uuid],'${source.sourceHash}','${key}');`),/multi_day_initial_draw_request_conflict/);
   assert.throws(()=>call(`SELECT public.multi_day_plan_initial_draw_v1('${event}',ARRAY[${ids}],'${'0'.repeat(32)}','${randomUUID()}');`),/multi_day_initial_draw_source_stale/);
   console.log('MULTIDAY_THREE_SELECTED_TABLES_IMMUTABLE_PREVIEW_NO_SEAT_PASS',JSON.stringify({event,planId:plan.planId}));
   if(process.argv.includes('--cancel-plan')) {
    const discard=call(`SELECT public.multi_day_plan_initial_draw_v1('${event}',ARRAY[${ids}],'${source.sourceHash}','${randomUUID()}');`);
    const cancelKey=randomUUID(),cancelQuery=`SELECT public.multi_day_cancel_initial_draw_v1('${discard.planId}','${cancelKey}');`;
    let canceled;
    if(process.argv.includes('--decision-overlap')) {
     const tag=randomUUID().slice(0,8),hold=session(`d2_cancel_${tag}`),late=session(`d2_late_apply_${tag}`);
     try {
      hold.child.stdin.write(`BEGIN;${actor}${cancelQuery}SELECT 'CANCEL_DECISION';\n`);
      await until(()=>hold.output().includes('CANCEL_DECISION'));
      late.child.stdin.end(`BEGIN;${actor}SELECT public.multi_day_apply_initial_draw_v1('${discard.planId}','${randomUUID()}');COMMIT;`);
      await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='d2_late_apply_${tag}' AND wait_event_type='Lock';`)==='1');
      hold.child.stdin.end('COMMIT;\n');canceled=JSON.parse((await hold.closed).split('\n').find(line=>line.startsWith('{')));
      await assert.rejects(late.closed,/multi_day_initial_draw_cancelled/);
     } finally {for(const pending of [hold,late]){pending.child.stdin.end();if(pending.child.exitCode===null)pending.child.kill();}}
    } else canceled=call(cancelQuery);
    assert.equal(canceled.state,'CANCELLED');assert.equal(canceled.planId,discard.planId);
    assert.equal(call(cancelQuery).idempotent,true);
    assert.deepEqual(call(`SELECT public.multi_day_get_initial_draw_resolution_v1('${event}','${discard.planId}');`).cancellation,canceled);
    assert.throws(()=>call(`SELECT public.multi_day_cancel_initial_draw_v1('${plan.planId}','${cancelKey}');`),/multi_day_initial_draw_request_conflict/);
    assert.throws(()=>call(`SELECT public.multi_day_apply_initial_draw_v1('${discard.planId}','${randomUUID()}');`),/multi_day_initial_draw_cancelled/);
    assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0');
   }
   if(process.argv.includes('--initial-apply')) {
    const applyKey=randomUUID(),applyQuery=`SELECT public.multi_day_apply_initial_draw_v1('${plan.planId}','${applyKey}');`;
    const alternative=process.argv.includes('--apply-faults')?call(`SELECT public.multi_day_plan_initial_draw_v1('${event}',ARRAY[${ids}],'${source.sourceHash}','${randomUUID()}');`):null;
    if(process.argv.includes('--apply-faults')) {
     const outsider=randomUUID();
     assert.throws(()=>sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${outsider}';SET LOCAL ROLE authenticated;${applyQuery}ROLLBACK;`),/multi_day_initial_draw_actor_denied/);
     assert.throws(()=>sql(`BEGIN;UPDATE public.table_sessions SET revision=revision+1 WHERE id='${plan.selectedTables[0].tableSessionId}';${actor}${applyQuery}ROLLBACK;`),/multi_day_initial_draw_table_stale/);
     if(players.length>1)assert.throws(()=>sql(`BEGIN;
       CREATE FUNCTION pg_temp.fail_second_d2_seat() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
        IF NEW.tournament_id='${final}' AND (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}')=2
        THEN RAISE EXCEPTION 'injected_second_d2_seat_fault';END IF;RETURN NEW;END $$;
       CREATE TRIGGER local_fail_second_d2 AFTER INSERT ON public.tournament_seats
        FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_d2_seat();
       ${actor}${applyQuery}ROLLBACK;`),/injected_second_d2_seat_fault/);
     assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0');
     assert.equal(sql(`SELECT count(*) FROM public.tournament_chip_counts WHERE tournament_id='${final}';`),'0');
     assert.equal(call(`SELECT public.multi_day_get_initial_draw_application_v1('${event}','${plan.planId}');`).application,null);
    }
    let applied;
    if(process.argv.includes('--apply-overlap')) {
     const tag=randomUUID().slice(0,8),lock=session(`d2_hold_${tag}`);
     const a=session(`d2_apply_a_${tag}`),b=session(`d2_apply_b_${tag}`);
     try {
      lock.child.stdin.write(`BEGIN;SELECT id FROM public.tournaments WHERE id='${final}' FOR UPDATE;SELECT 'D2_LOCK_HELD';\n`);
      await until(()=>lock.output().includes('D2_LOCK_HELD'));
      for(const pending of [a,b])pending.child.stdin.end(`BEGIN;${actor}${applyQuery}COMMIT;`);
      await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN('d2_apply_a_${tag}','d2_apply_b_${tag}') AND wait_event_type='Lock';`)==='2');
      lock.child.stdin.end('COMMIT;\n');await lock.closed;
      const pair=(await Promise.all([a.closed,b.closed])).map(output=>JSON.parse(output.trim()));
      assert.equal(pair.filter(row=>row.idempotent).length,1);
      assert.deepEqual(pair[0].seatReceipts,pair[1].seatReceipts);
      applied=pair.find(row=>!row.idempotent);
      console.log('MULTIDAY_ACTUAL_TWO_SESSION_APPLY_LOCK_OVERLAP_PASS',JSON.stringify({event,planId:plan.planId}));
     } finally {for(const pending of [lock,a,b]){pending.child.stdin.end();if(pending.child.exitCode===null)pending.child.kill();}}
    } else if(process.argv.includes('--decision-overlap')) {
     const tag=randomUUID().slice(0,8),hold=session(`d2_apply_${tag}`),late=session(`d2_late_cancel_${tag}`);
     try {
      hold.child.stdin.write(`BEGIN;${actor}${applyQuery}SELECT 'APPLY_DECISION';\n`);
      await until(()=>hold.output().includes('APPLY_DECISION'));
      late.child.stdin.end(`BEGIN;${actor}SELECT public.multi_day_cancel_initial_draw_v1('${plan.planId}','${randomUUID()}');COMMIT;`);
      await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='d2_late_cancel_${tag}' AND wait_event_type='Lock';`)==='1');
      hold.child.stdin.end('COMMIT;\n');applied=JSON.parse((await hold.closed).split('\n').find(line=>line.startsWith('{')));
      const outcome=JSON.parse((await late.closed).trim());assert.equal(outcome.state,'APPLIED');assert.deepEqual(outcome.application,applied);
      console.log('MULTIDAY_CANCEL_APPLY_BOTH_ACTUAL_LOCK_ORDERS_PASS',JSON.stringify({event,planId:plan.planId}));
     } finally {for(const pending of [hold,late]){pending.child.stdin.end();if(pending.child.exitCode===null)pending.child.kill();}}
    } else applied=call(applyQuery);
    assert.equal(applied.state,'APPLIED');assert.equal(applied.seatReceipts.length,players.length);
    parseD2Application(applied,plan,source,applyKey);
    assert.equal(applied.seatReceipts[0].seedStack,expected);
    assert.equal(call(applyQuery).idempotent,true);
    if(process.argv.includes('--cancel-plan')) {
     const after=call(`SELECT public.multi_day_cancel_initial_draw_v1('${plan.planId}','${randomUUID()}');`);
     assert.equal(after.state,'APPLIED');assert.deepEqual(after.application,applied);
     assert.equal(call(`SELECT public.multi_day_get_initial_draw_resolution_v1('${event}','${plan.planId}');`).cancellation,null);
    }
    if(alternative) {
     assert.throws(()=>call(`SELECT public.multi_day_apply_initial_draw_v1('${alternative.planId}','${applyKey}');`),/multi_day_initial_draw_request_conflict/);
     assert.throws(()=>call(`SELECT public.multi_day_apply_initial_draw_v1('${plan.planId}','${randomUUID()}');`),/multi_day_initial_draw_already_applied_use_receipt/);
     assert.throws(()=>sql(`BEGIN;UPDATE public.clubs SET owner_id='${players[1]??f.player}' WHERE id='${f.club}';${actor}${applyQuery}ROLLBACK;`),/multi_day_final_roster_denied/);
    }
    assert.deepEqual(call(`SELECT public.multi_day_get_initial_draw_application_v1('${event}','${plan.planId}');`).application,applied);
    assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),String(players.length));
    assert.equal(Number(sql(`SELECT sum(chip_count) FROM public.tournament_chip_counts WHERE tournament_id='${final}';`)),expected*players.length);
    const distribution=JSON.parse(sql(`SELECT jsonb_agg(n) FROM(SELECT count(*) n FROM public.tournament_seats WHERE tournament_id='${final}' AND is_active GROUP BY tournament_table_id) x;`));
    assert.ok(Math.max(...distribution)-Math.min(...distribution)<=1);
    assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${final}';`),'0');
    if(process.argv.includes('--initial-tv')) {
     const publicRead=(tour=final)=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
       SELECT public.get_public_tournament_redraw_v1('${tour}');COMMIT;`));
     const snapshot=publicRead();assert.equal(snapshot.kind,'initial_d2');assert.equal(snapshot.batch_id,plan.planId);
     assert.equal(snapshot.moves.length,players.length);
     assert.ok(snapshot.moves.every(m=>m.from_table_number===null&&m.from_seat_number===null));
     assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE tournament_id='${final}' AND redraw_hold_batch_id='${plan.planId}';`),'3');
     const paused=clockState();
     assert.ok(paused.paused,'initial D2 redraw must pause a running clock');
     assert.equal(paused.started,clockBefore.started);
     assert.equal(paused.level,clockBefore.level);
     assert.equal(paused.accumulated,clockBefore.accumulated);
     // Wall-clock delay, not a rewritten timestamp: verify pause compensation.
     await new Promise(resolve=>setTimeout(resolve,1100));
     const continued=call(`SELECT public.floor_continue_tournament_redraw_v1('${plan.planId}',${snapshot.redraw_revision},'${randomUUID()}');`);
     assert.equal(continued.ok,true,JSON.stringify(continued));
     assert.equal(continued.clock_resumed,true);
     const resumed=clockState();assert.equal(resumed.paused,null);
     assert.equal(resumed.started,clockBefore.started);
     assert.equal(resumed.level,clockBefore.level);
     assert.ok(resumed.accumulated>=paused.accumulated+1,'hold duration must not consume blind time');
     assert.equal(publicRead().batch_id,null);
     assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE tournament_id='${final}' AND redraw_hold_batch_id IS NOT NULL;`),'0');
     const legacyTarget=sql(`SELECT game_table_id FROM public.tournament_tables WHERE tournament_id='${f.tour}' ORDER BY table_number LIMIT 1;`);
     const legacyPlan=call(`SELECT public.floor_plan_tournament_redraw_v1('${f.tour}',9,ARRAY['${legacyTarget}'::uuid],'${randomUUID()}');`);
     assert.equal(legacyPlan.ok,true,JSON.stringify(legacyPlan));
     assert.equal(call(`SELECT public.floor_apply_tournament_redraw_v1('${legacyPlan.batch_id}','${randomUUID()}');`).ok,true);
     const legacyTv=publicRead(f.tour);assert.equal(legacyTv.batch_id,legacyPlan.batch_id);
     assert.equal(legacyTv.kind,undefined);assert.ok(legacyTv.moves.every(m=>Number.isInteger(m.from_seat_number)&&m.from_seat_number>0));
     assert.equal(call(`SELECT public.floor_continue_tournament_redraw_v1('${legacyPlan.batch_id}',${legacyTv.redraw_revision},'${randomUUID()}');`).ok,true);
     console.log('D2_ANON_INITIAL_HOLD_CONTINUE_AND_LEGACY_REDRAW_PASS',JSON.stringify({event,final}));
     if(process.argv.includes('--d2-hand')) {
      assert.equal(players.length,8,'D2 hand continuation requires multiplayer fixture');
      const {runD2InitialHand}=await import('../trackerVoice/paidTourHand.native.mjs');
      await runD2InitialHand(sql,{actor:f.actor,club:f.club,tour:final,event,plan:plan.planId},expected*players.length);
     }
    }
    if(process.argv.includes('--payout-journey')){
     const {runD2OfficialPayoutJourney}=await import('../cashier/d2OfficialPayoutJourney.native.mjs');
     await runD2OfficialPayoutJourney(sql,{...f,event,tour:final,policy,players,plan:plan.planId});
    }
    console.log('MULTIDAY_INITIAL_DRAW_ATOMIC_APPLY_RECEIPT_PASS',JSON.stringify({event,final,planId:plan.planId,applyKey}));
    continue;
   }
  }
  if(process.argv.includes('--d2-read')) {
   const roster=readD2();assert.equal(roster.tables.length,1);
   assert.equal(roster.tables[0].tournamentTableId,table);assert.equal(roster.tables[0].physicalTableId,physical);
   assert.equal(roster.tables[0].blocker,null);assert.equal(roster.tables[0].capacity,9);
   const outsider=randomUUID();
   assert.throws(()=>sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${outsider}';SET LOCAL ROLE authenticated;
     SELECT public.multi_day_final_roster_v1('${event}');ROLLBACK;`),/multi_day_final_roster_denied/);
  }
  const query=`SELECT public.multi_day_seat_final_v1('${event}','${f.player}','${table}',1,0,'${randomUUID()}');`;
  const sessionId=sql(`SELECT table_session_id FROM public.tournament_tables WHERE id='${table}';`);
  const denied=(change,pattern)=>{
   assert.throws(()=>sql(`BEGIN;${change}${actor}${query}ROLLBACK;`),pattern);
   assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0','failed seating must roll back the entire entry write');
  };
  if(process.argv.includes('--destination-guards')) {
   denied(`UPDATE public.table_sessions SET closed_at=now() WHERE id='${sessionId}';`,/multi_day_final_session_mismatch/);
   denied(`UPDATE public.tournament_tables SET table_id=(SELECT game_table_id FROM public.tournament_tables WHERE tournament_id='${f.tour}' LIMIT 1) WHERE id='${table}';`,/multi_day_final_table_unavailable/);
   denied(`INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
     VALUES('${final}','${table}','${sessionId}',1,'local TEST guard','${f.actor}');`,/multi_day_final_destination_blocked/);
   denied(`INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count) VALUES('${final}','${f.player}',1,1);`,/multi_day_final_chip_projection_mismatch/);
  }
  let seated;
  try { seated=call(query); }
  catch(error) {
   if(!process.argv.includes('--diagnose-canonical-id-gap') || !String(error).includes('multi_day_final_table_unavailable')) throw error;
   const identity=JSON.parse(sql(`SELECT jsonb_build_object('canonical',game_table_id,'legacy',table_id,'session',table_session_id,'status',status) FROM public.tournament_tables WHERE id='${table}';`));
   assert.equal(identity.canonical,physical);assert.equal(identity.legacy,null);assert.equal(identity.status,'active');assert.ok(identity.session);
   assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${final}';`),'0');
   console.log('REPRO_MULTIDAY_FINAL_SEATING_CANONICAL_ID_MISMATCH_NOT_PASS',JSON.stringify({policy,event,final,flights,carriedStack:expected,identity}));
   continue;
  }
  assert.equal(seated.state,'SEATED');assert.equal(seated.seedStack,expected);assert.equal(seated.denominationIssuance,'NONE');
  assert.equal(call(query).idempotent,true);
  const count=sql(`SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='${final}' AND player_id='${f.player}';`);
  assert.notEqual(count,'','missing count is not zero');assert.equal(Number(count),expected);
  assert.equal(Number(sql(`SELECT chip_count FROM public.tournament_seats WHERE tournament_id='${final}' AND player_id='${f.player}' AND is_active;`)),expected);
  assert.equal(sql(`SELECT player_name FROM public.tournament_seats WHERE tournament_id='${final}' AND player_id='${f.player}' AND is_active;`),'Multi-day paid local TEST');
  assert.equal(sql(`SELECT table_id FROM public.tournament_entries WHERE tournament_id='${final}' AND player_id='${f.player}';`),physical);
  assert.equal(sql(`SELECT table_id FROM public.seat_draw_receipts WHERE tournament_id='${final}' AND player_id='${f.player}';`),physical);
  assert.equal(sql(`SELECT to_table_id FROM public.seat_assignment_history WHERE tournament_id='${final}' AND player_id='${f.player}' AND reason='day2_seat';`),physical);
  assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${final}';`),'0');
  if(process.argv.includes('--d2-read')) {
   const roster=readD2();assert.equal(roster.players[0].state,'SEATED');
   assert.equal(roster.players[0].entryId,seated.entryId);assert.equal(roster.players[0].seatId,seated.seatId);
   assert.equal(roster.players[0].stack,expected);
  }
  console.log('MULTI_DAY_TWO_FLIGHTS_BAG_CHIP_MASTER_FINAL_STACK_LOCAL_PASS',JSON.stringify({policy,event,final,flights,carriedStack:expected}));
 } finally {
  if(process.argv.includes('--initial-apply')) {
   assert.equal(opsGateBefore.length,1);const gate=opsGateBefore[0];
   sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=${gate.enabled},allowed_club_ids=ARRAY[${gate.allowed_club_ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[] WHERE id;`);
  }
  // Restore only this test's temporary global release configuration, never data.
  const rows=JSON.parse(gateBefore);assert.ok(rows.length<=1);
  if(rows.length) {
   const gate=rows[0];
   sql(`UPDATE public.multi_day_package_release_v1 SET enabled=${gate.enabled},allowed_club_ids=ARRAY[${gate.allowed_club_ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[],updated_at='${gate.updated_at.replaceAll("'","''")}'::timestamptz WHERE id;`);
  } else sql(`DELETE FROM public.multi_day_package_release_v1 WHERE id AND allowed_club_ids=ARRAY['${f.club}'::uuid];`);
 }
}

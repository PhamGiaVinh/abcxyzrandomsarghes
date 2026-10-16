import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';

assert.equal(process.env.VINPOKER_NATIVE_CROSS_FLOW,'1');
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'})) assert.equal(process.env[key],value);
const prefix=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql'];
const sql=query=>execFileSync('wsl',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000}).trim();
for(const policy of ['SELECT_LARGEST','SUM_STACKS']) {
 const f=createPaidJourneyFixture(sql),event=randomUUID(),final=randomUUID(),flights=[randomUUID(),randomUUID()];
 const actor=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const call=query=>JSON.parse(sql(`BEGIN;${actor}${query}COMMIT;`));
 const gateBefore=sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb)::text FROM public.multi_day_package_release_v1 g;");
 try {
  // Synthetic metadata; all payment/bag/qualification/seating mutations below
  // use the actual RPCs. No denomination inventory or financial source is faked.
  sql(`INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,buy_in,starting_stack)
  VALUES('${final}','${f.club}','Multi-day Final local TEST','active','registering','final',100000,20000);
  INSERT INTO public.tournament_events(id,club_id,name,final_tournament_id,itm_percent,buy_in,rake_amount)
  VALUES('${event}','${f.club}','Multi-day ${policy} local TEST','${final}',100,100000,0);
  UPDATE public.tournaments SET event_id='${event}' WHERE id='${final}';
  INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids) VALUES(true,true,ARRAY['${f.club}'::uuid])
  ON CONFLICT(id) DO UPDATE SET enabled=true,allowed_club_ids=excluded.allowed_club_ids;`);
  call(`SELECT public.multi_day_set_qualification_rules_v2('${event}','${policy}',1,100);`);
  for(const [index,flight] of flights.entries()) {
   const physical=randomUUID(),dealer=randomUUID(),attendance=randomUUID(),shift=randomUUID();
   sql(`INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,flight_label,event_id,buy_in,starting_stack)
   VALUES('${flight}','${f.club}','Multi-day Flight ${index} local TEST','active','registering','flight','${index}','${event}',100000,20000);
   INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
   VALUES('${physical}','${f.club}','Multi-day local TEST ${index}',${index+10},'tournament','inactive','available');`);
   const opened=call(`SELECT public.floor_open_tournament_table_v3('${flight}','${physical}','manual','${randomUUID()}');`);assert.equal(opened.ok,true);
   const registration=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
   SELECT public.cashier_create_app_registration_v1('${flight}','${f.player}');COMMIT;`));assert.equal(registration.ok,true);
   const paid=call(`SELECT public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id','${f.actor}','club_id','${f.club}',
   'tournament_id','${flight}','registration_id','${registration.registration_id}','amount',100000,'request_id','${randomUUID()}'),'record');`);
   assert.equal(paid.status,'recorded');assert.equal(paid.result.seating_state,'seated');
   const context=JSON.parse(sql(`SELECT jsonb_build_object('table',tt.id,'session',s.id,'epoch',s.control_epoch,'revision',s.revision)
   FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id WHERE tt.tournament_id='${flight}';`));
   assert.equal(call(`SELECT public.floor_request_table_control_mode_v4('${context.table}','${context.session}','tracker',${context.revision},${context.epoch},'${randomUUID()}');`).ok,true);
   const epoch=Number(sql(`SELECT control_epoch FROM public.table_sessions WHERE id='${context.session}';`));
   const snapshot=call(`SELECT public.get_tracker_roster_snapshot_v2('${flight}','${context.table}','${context.session}',${epoch});`);
   const rosterSeat=snapshot.seats.find(row=>row.seat?.player_id===f.player);assert.ok(rosterSeat);
   const setup=call(`SELECT public.set_tracker_table_roster_seat_v2(p_tournament_id=>'${flight}',p_tournament_table_id=>'${context.table}',
   p_table_session_id=>'${context.session}',p_expected_epoch=>${epoch},p_seat_number=>${rosterSeat.seat_number},
   p_player_name=>'Multi-day paid local TEST',p_chip_count=>20000,p_existing_player_id=>'${f.player}',p_touch_avatar=>false,p_avatar_url=>NULL,
   p_expected_seat_token=>'${rosterSeat.token}',p_request_id=>'${randomUUID()}');`);assert.equal(setup.ok,true);
   // Assignment is a fixture precondition, not an Auto Swing acceptance claim.
   sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';
   SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${f.actor}"}';
   INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${f.club}','Multi-day local TEST','00:00','23:59');
   INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealer}','${f.club}','Multi-day local TEST','active');
   INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
   VALUES('${attendance}','${dealer}','${shift}',current_date,'checked_in',now(),'assigned');
   INSERT INTO public.dealer_assignments(table_id,table_session_id,club_id,dealer_id,attendance_id,status,assigned_at)
   SELECT '${physical}',table_session_id,'${f.club}','${dealer}','${attendance}','assigned',now() FROM public.tournament_tables WHERE tournament_id='${flight}';COMMIT;`);
   const cashBefore=sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM public.cashier_buyin_movements m WHERE tournament_id='${flight}';`);
   const ended=call(`SELECT public.multi_day_end_flight_v1('${flight}',${index+1},'${randomUUID()}');`);assert.equal(ended.ok,true);
   let state=call(`SELECT public.multi_day_bagging_state_v1('${flight}');`);
   assert.equal(state.rows.length,1);assert.equal(state.rows[0].trackedStack,20000);
   const recordId=randomUUID(),recordQuery=`SELECT public.multi_day_record_bag_v1('${flight}','${f.player}','BAG-${index}',20000,0,'${recordId}');`;
   const recorded=call(recordQuery);assert.equal(recorded.ok,true);assert.equal(call(recordQuery).idempotent,true);
   const sealed=call(`SELECT public.multi_day_seal_bag_v1('${flight}','${f.player}',${recorded.revision},'${randomUUID()}');`);assert.equal(sealed.sealed,true);
   state=call(`SELECT public.multi_day_bagging_state_v1('${flight}');`);
   assert.equal(state.rows[0].bagTotal,20000);assert.equal(state.rows[0].sealed,true);
   assert.equal(call(`SELECT public.multi_day_close_bagging_v1('${flight}',${state.dayVersion},'${randomUUID()}');`).ok,true);
   assert.equal(sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM public.cashier_buyin_movements m WHERE tournament_id='${flight}';`),cashBefore,'bagging must not charge another buy-in');
  }
  const preview=call(`SELECT public.multi_day_qualification_preview_v1('${event}');`);
  assert.equal(preview.flights.length,2);const bags=preview.flights.flatMap(flight=>flight.eligibleBags.map(bag=>bag.bagId));assert.equal(bags.length,2);
  const locked=call(`SELECT public.multi_day_lock_qualification_v1('${event}',ARRAY[${bags.map(id=>`'${id}'::uuid`).join(',')}],'${preview.sourceHash}','${randomUUID()}');`);
  assert.equal(locked.ok,true);
  const expected=policy==='SUM_STACKS'?40000:20000;
  assert.equal(Number(sql(`SELECT carried_stack FROM public.multi_day_final_participations_v1 WHERE event_id='${event}' AND player_id='${f.player}';`)),expected);
  const physical=randomUUID();sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
  VALUES('${physical}','${f.club}','Multi-day final local TEST',20,'tournament','inactive','available');`);
  assert.equal(call(`SELECT public.floor_open_tournament_table_v3('${final}','${physical}','manual','${randomUUID()}');`).ok,true);
  const table=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${final}';`);
  const query=`SELECT public.multi_day_seat_final_v1('${event}','${f.player}','${table}',1,0,'${randomUUID()}');`;
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
  assert.equal(Number(sql(`SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='${final}' AND player_id='${f.player}';`)),expected);
  assert.equal(Number(sql(`SELECT chip_count FROM public.tournament_seats WHERE tournament_id='${final}' AND player_id='${f.player}' AND is_active;`)),expected);
  assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${final}';`),'0');
  console.log('MULTI_DAY_TWO_FLIGHTS_BAG_CHIP_MASTER_FINAL_STACK_LOCAL_PASS',JSON.stringify({policy,event,final,flights,carriedStack:expected}));
 } finally {
  // Restore only this test's temporary global release configuration, never data.
  const rows=JSON.parse(gateBefore);assert.ok(rows.length<=1);
  if(rows.length) {
   const gate=rows[0];
   sql(`UPDATE public.multi_day_package_release_v1 SET enabled=${gate.enabled},allowed_club_ids=ARRAY[${gate.allowed_club_ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[];`);
  } else sql(`DELETE FROM public.multi_day_package_release_v1 WHERE id AND allowed_club_ids=ARRAY['${f.club}'::uuid];`);
 }
}

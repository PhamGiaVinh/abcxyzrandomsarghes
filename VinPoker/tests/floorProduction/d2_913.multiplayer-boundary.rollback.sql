-- R03 canonical multiplayer SUM_STACKS preparation and hand/move negatives, owned clone / ROLLBACK only.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.d2_789_fingerprint() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_entries x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_seats x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_tables x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.table_sessions x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.cashier_buyin_movements x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_chip_counts x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.table_session_seat_locks x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM private.multi_day_initial_draw_plans_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM private.multi_day_initial_draw_applications_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_package_release_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.centerpoint_tournament_ops_release x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_final_stack_revisions_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_final_requests_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_final_seatings_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.chip_bag x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_hands x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_prize_payments x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_final_participations_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournaments x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_levels x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.floor_pending_tracker_moves x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.table_operation_receipts x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.hand_players x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.hand_actions x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.day_close x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_flight_roster_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_qualification_rules_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_qualification_locks_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.dealer_assignments x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.dealer_attendance x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.dealers x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.dealer_shifts x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM auth.users x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM floor_private.tracker_hand_seat_snapshots193 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_registrations x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.seat_draw_receipts x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.seat_assignment_history x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.club_settings x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM net.cash_ui_http_sink x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_events x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.notifications x)
 )::text)
$$;
CREATE TEMP TABLE d2_789_protected AS SELECT pg_temp.d2_789_fingerprint() fingerprint;
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ranking860_local';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT (SELECT package_hash FROM floor_private.ranking860_install_backup)='d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
END $$;
-- Transaction-private business qualification only, not persistent gate activation.
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['c0d7785d-5bd4-48ca-9014-8611a274382d'::uuid]) x) WHERE id;
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['c0d7785d-5bd4-48ca-9014-8611a274382d'::uuid]) x) WHERE id;
DO $$ DECLARE
 club uuid:='c0d7785d-5bd4-48ca-9014-8611a274382d'; actor uuid:='495e96be-c00b-4e68-b227-593300f3e2bc';
 event uuid:=gen_random_uuid(); final uuid:=gen_random_uuid(); flights uuid[]:='{}'; players uuid[];
 physical uuid; flight uuid; player uuid; dealer uuid; attendance uuid; shift uuid;
 r jsonb; reg jsonb; paid jsonb; opened jsonb; snap jsonb; recorded jsonb; state jsonb; preview jsonb; plan jsonb; applied jsonb;
 tt uuid; sess uuid; rev bigint; epoch bigint; roster_seat jsonb; bags uuid[];
 selected uuid[]:='{}'; sessions uuid[]:='{}'; keys uuid[]:='{}'; seat_result jsonb; seeded_entry uuid;
 p uuid; pending_plan uuid; h uuid; denied boolean; table_no integer; i integer; j integer; amount_before numeric; protected_before_start text;
BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor);
 SELECT array_agg(player_id ORDER BY player_id) INTO players FROM public.multi_day_final_participations_v1
  WHERE event_id='1cb64e29-c5d8-43e3-b8d9-7815905749b1';
 ASSERT cardinality(players)=8;
 ASSERT (SELECT count(*)=8 FROM auth.users WHERE id=ANY(players));
 SELECT coalesce(max(table_number),0)+10 INTO table_no FROM public.game_tables WHERE club_id=club;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 -- Synthetic event/table/staff metadata only. All operational money/bag/seat writes below are canonical RPCs.
 INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,buy_in,starting_stack)
 VALUES(final,club,'D2 913 SUM_STACKS boundary TEST','active','registering','final',100000,20000);
 INSERT INTO public.tournament_events(id,club_id,name,final_tournament_id,itm_percent,buy_in,rake_amount)
 VALUES(event,club,'D2 913 two flights boundary TEST',final,100,100000,0);
 UPDATE public.tournaments SET event_id=event WHERE id=final;
 PERFORM set_config('role','authenticated',true);
 r:=public.multi_day_set_qualification_rules_v2(event,'SUM_STACKS',1,100);ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 FOR i IN 1..2 LOOP
  flight:=gen_random_uuid();flights:=array_append(flights,flight);physical:=gen_random_uuid();
  INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,flight_label,event_id,buy_in,starting_stack)
  VALUES(flight,club,'D2 913 Flight TEST '||i,'active','registering','flight',i::text,event,100000,20000);
  INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
  VALUES(physical,club,'D2 913 Flight physical TEST '||i,table_no+i,'tournament','inactive','available');
  PERFORM set_config('role','authenticated',true);
  opened:=public.floor_open_tournament_table_v3(flight,physical,'manual',gen_random_uuid());ASSERT opened->>'ok'='true',opened::text;
  PERFORM set_config('role','none',true);
  FOREACH player IN ARRAY players LOOP
   PERFORM set_config('request.jwt.claim.sub','',true);
   PERFORM set_config('request.jwt.claim.role','service_role',true);
   PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
   PERFORM set_config('role','service_role',true);
   reg:=public.cashier_create_app_registration_v1(flight,player);ASSERT reg->>'ok'='true',reg::text;
   PERFORM set_config('role','none',true);
   PERFORM set_config('request.jwt.claim.sub',actor::text,true);
   PERFORM set_config('request.jwt.claim.role','authenticated',true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
   PERFORM set_config('role','authenticated',true);
   paid:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id',actor,'club_id',club,'tournament_id',flight,
    'registration_id',reg->>'registration_id','amount',100000,'request_id',gen_random_uuid()),'record');
   ASSERT paid->>'status'='recorded' AND paid->'result'->>'seating_state'='seated',paid::text;
   PERFORM set_config('role','none',true);
  END LOOP;
  SELECT t.id,s.id,s.revision,s.control_epoch INTO STRICT tt,sess,rev,epoch FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id=flight;
  PERFORM set_config('role','authenticated',true);
  r:=public.floor_request_table_control_mode_v4(tt,sess,'tracker',rev,epoch,gen_random_uuid());ASSERT r->>'ok'='true',r::text;
  PERFORM set_config('role','none',true);
  SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=sess;
  PERFORM set_config('role','authenticated',true);
  FOREACH player IN ARRAY players LOOP
   snap:=public.get_tracker_roster_snapshot_v2(flight,tt,sess,epoch);
   SELECT x INTO STRICT roster_seat FROM jsonb_array_elements(snap->'seats')x WHERE x->'seat'->>'player_id'=player::text;
   r:=public.set_tracker_table_roster_seat_v2(p_tournament_id=>flight,p_tournament_table_id=>tt,p_table_session_id=>sess,
    p_expected_epoch=>epoch,p_seat_number=>(roster_seat->>'seat_number')::integer,p_player_name=>'D2 913 qualifier TEST',p_chip_count=>20000,
    p_existing_player_id=>player,p_touch_avatar=>false,p_avatar_url=>NULL,p_expected_seat_token=>roster_seat->>'token',p_request_id=>gen_random_uuid());
   ASSERT r->>'ok'='true',r::text;
  END LOOP;
  PERFORM set_config('role','none',true);
  dealer:=gen_random_uuid();attendance:=gen_random_uuid();shift:=gen_random_uuid();
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',actor)::text,true);
  INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,club,'D2 913 TEST','00:00','23:59');
  INSERT INTO public.dealers(id,club_id,full_name,status) VALUES(dealer,club,'D2 913 fixture TEST','active');
  INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
  VALUES(attendance,dealer,shift,current_date,'checked_in',now(),'assigned');
  INSERT INTO public.dealer_assignments(table_id,table_session_id,club_id,dealer_id,attendance_id,status,assigned_at)
  VALUES(physical,sess,club,dealer,attendance,'assigned',now());
  PERFORM set_config('role','authenticated',true);
  r:=public.multi_day_end_flight_v1(flight,i,gen_random_uuid());ASSERT r->>'ok'='true',r::text;
  state:=public.multi_day_bagging_state_v1(flight);ASSERT jsonb_array_length(state->'rows')=8;
  j:=0;
  FOREACH player IN ARRAY players LOOP
   j:=j+1;
   recorded:=public.multi_day_record_bag_v1(flight,player,'D2-913-'||i||'-'||j,20000,0,gen_random_uuid());ASSERT recorded->>'ok'='true',recorded::text;
   r:=public.multi_day_seal_bag_v1(flight,player,(recorded->>'revision')::integer,gen_random_uuid());ASSERT r->>'sealed'='true',r::text;
  END LOOP;
  state:=public.multi_day_bagging_state_v1(flight);
  r:=public.multi_day_close_bagging_v1(flight,(state->>'dayVersion')::integer,gen_random_uuid());ASSERT r->>'ok'='true',r::text;
  PERFORM set_config('role','none',true);
 END LOOP;
 PERFORM set_config('role','authenticated',true);
 preview:=public.multi_day_qualification_preview_v1(event);ASSERT jsonb_array_length(preview->'flights')=2;
 SELECT array_agg((b->>'bagId')::uuid ORDER BY b->>'bagId') INTO bags FROM jsonb_array_elements(preview->'flights')f CROSS JOIN LATERAL jsonb_array_elements(f->'eligibleBags')b;
 ASSERT cardinality(bags)=16;
 r:=public.multi_day_lock_qualification_v1(event,bags,preview->>'sourceHash',gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=8 AND sum(carried_stack)=320000 AND bool_and(carried_stack=40000) FROM public.multi_day_final_participations_v1 WHERE event_id=event);
 FOR i IN 1..3 LOOP
  physical:=gen_random_uuid();
  INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
  VALUES(physical,club,'D2 913 Final physical TEST '||i,table_no+2+i,'tournament','inactive','available');
  PERFORM set_config('role','authenticated',true);
  opened:=public.floor_open_tournament_table_v3(final,physical,'manual',gen_random_uuid());ASSERT opened->>'ok'='true',opened::text;
  PERFORM set_config('role','none',true);
  SELECT id,table_session_id INTO STRICT tt,sess FROM public.tournament_tables WHERE tournament_id=final AND game_table_id=physical;
  selected:=array_append(selected,tt);sessions:=array_append(sessions,sess);
 END LOOP;
 PERFORM set_config('role','authenticated',true);
 FOR i IN 1..3 LOOP
  seat_result:=public.multi_day_seat_final_v1(event,players[i],CASE WHEN i=3 THEN selected[2] ELSE selected[1] END,CASE WHEN i=3 THEN 1 ELSE i END,0,gen_random_uuid());ASSERT seat_result->>'state'='SEATED',seat_result::text;
  IF i=3 THEN seeded_entry:=(seat_result->>'entryId')::uuid; END IF;
 END LOOP;
 PERFORM set_config('role','none',true);
 tt:=selected[1];sess:=sessions[1];
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_request_table_control_mode_v4(tt,sess,'tracker',rev,epoch,gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 UPDATE public.tournaments SET current_level=1 WHERE id=final;
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break) VALUES(final,1,100,200,0,false);
 PERFORM set_config('role','authenticated',true);
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT (SELECT count(*)=5 FROM jsonb_array_elements(snap->'players')x WHERE x->>'state'='UNSEATED');
 plan:=public.multi_day_plan_initial_draw_v1(event,selected,snap->>'sourceHash',gen_random_uuid());ASSERT plan->>'state'='PLANNED';p:=(plan->>'planId')::uuid;
 ASSERT jsonb_array_length(plan->'assignments')=5;
 PERFORM set_config('role','none',true);
 protected_before_start:=pg_temp.d2_789_fingerprint();
 BEGIN
  SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=sess;
  PERFORM set_config('role','authenticated',true);
  r:=public.start_tracker_hand_v3(final,tt,sess,epoch,1,now(),actor,1);ASSERT r->>'status'='success',r::text;h:=(r->>'hand_id')::uuid;
  snap:=public.multi_day_final_roster_v1(event);
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'tables')t WHERE t->>'tournamentTableId'=tt::text AND t->>'blocker'='active_hand');
  denied:=false;
  BEGIN PERFORM public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
  EXCEPTION WHEN serialization_failure THEN ASSERT SQLERRM='multi_day_initial_draw_table_stale',SQLERRM;denied:=true;END;
  ASSERT denied,'active hand accepted D2 apply';
  PERFORM set_config('role','none',true);
  ASSERT (SELECT count(*)=3 FROM public.tournament_entries WHERE tournament_id=final);
  ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=h AND status='in_progress');
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p);
  RAISE EXCEPTION 'D2_913_ACTIVE_CHECKED' USING ERRCODE='ZX913';
 EXCEPTION WHEN SQLSTATE 'ZX913' THEN ASSERT SQLERRM='D2_913_ACTIVE_CHECKED';END;
 ASSERT protected_before_start=pg_temp.d2_789_fingerprint(),'Start probe leaked data';
 RAISE NOTICE 'D2_913_CANONICAL_FLIGHTS_BAGS_SUM8_PARTIAL_SEAT_START_DENIAL_PASS';
 BEGIN
  -- Destination tracker hand is OUTSIDE the pending probe's selected table set.
  -- The selected manual source exposes pending_move; its queue revision is also revalidated.
  -- Do not attribute this selected-table rejection to the destination active-hand blocker.
  SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=sessions[1];
  PERFORM set_config('role','authenticated',true);
  r:=public.start_tracker_hand_v3(final,selected[1],sessions[1],epoch,1,now(),actor,1);ASSERT r->>'status'='success',r::text;
  snap:=public.multi_day_final_roster_v1(event);
  r:=public.multi_day_plan_initial_draw_v1(event,ARRAY[selected[2]],snap->>'sourceHash',gen_random_uuid());
  ASSERT r->>'state'='PLANNED' AND jsonb_array_length(r->'selectedTables')=1;
  pending_plan:=(r->>'planId')::uuid;
  PERFORM set_config('role','none',true);
  SELECT revision INTO rev FROM public.table_sessions WHERE id=sessions[2];
  SELECT revision INTO epoch FROM public.table_sessions WHERE id=sessions[1];
  PERFORM set_config('role','authenticated',true);
  r:=public.floor_queue_tracker_move_v1(seeded_entry,selected[1],9,rev,epoch,gen_random_uuid());
  ASSERT r->>'ok'='true',r::text;
  snap:=public.multi_day_final_roster_v1(event);
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'tables')t WHERE t->>'tournamentTableId'=selected[2]::text AND t->>'blocker'='pending_move');
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'tables')t WHERE t->>'tournamentTableId'=selected[1]::text AND t->>'blocker'='active_hand');
  denied:=false;
  BEGIN PERFORM public.multi_day_apply_initial_draw_v1(pending_plan,gen_random_uuid());
  EXCEPTION WHEN serialization_failure THEN ASSERT SQLERRM='multi_day_initial_draw_table_stale',SQLERRM;denied:=true;END;
  ASSERT denied,'pending move accepted D2 apply';
  PERFORM set_config('role','none',true);
  ASSERT (SELECT count(*)=3 FROM public.tournament_entries WHERE tournament_id=final);
  ASSERT (SELECT count(*)=1 FROM public.floor_pending_tracker_moves WHERE tournament_id=final AND status='pending');
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id IN(p,pending_plan));
  RAISE EXCEPTION 'D2_913_PENDING_CHECKED' USING ERRCODE='ZX914';
 EXCEPTION WHEN SQLSTATE 'ZX914' THEN ASSERT SQLERRM='D2_913_PENDING_CHECKED';END;
 ASSERT protected_before_start=pg_temp.d2_789_fingerprint(),'pending move probe leaked data';
 -- The exact same five-person immutable plan now applies after rollback of both probes.
 PERFORM set_config('role','authenticated',true);
 keys:=ARRAY[gen_random_uuid()];
 applied:=public.multi_day_apply_initial_draw_v1(p,keys[1]);
 ASSERT applied->>'state'='APPLIED' AND jsonb_array_length(applied->'seatReceipts')=5,applied::text;
 r:=public.multi_day_apply_initial_draw_v1(p,keys[1]);
 ASSERT r=(applied||jsonb_build_object('idempotent',true)),'same plan/key replay changed receipt';
 denied:=false;
 BEGIN PERFORM public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_initial_draw_already_applied_use_receipt',SQLERRM;denied:=true;END;
 ASSERT denied,'new key reapplied the existing plan';
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(snap->'players')x WHERE x->>'state'='SEATED' AND (x->>'stack')::bigint=40000);
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=8 AND sum(current_stack)=320000 FROM public.tournament_entries WHERE tournament_id=final);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=320000 FROM public.tournament_chip_counts WHERE tournament_id=final);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=320000 FROM public.tournament_seats WHERE tournament_id=final AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=final),'D2 charged a new buy-in';
 ASSERT (SELECT count(*)=16 FROM public.cashier_buyin_movements WHERE tournament_id=ANY(flights));
 ASSERT (SELECT count(*)=1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p);
 RAISE NOTICE 'D2_913_PENDING_DENIAL_SAME_PLAN_APPLY5_TOTAL8_STACK320K_REPLAY_PASS';
END $$;
ROLLBACK;
DO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'outer rollback changed protected facts';END $$;
SELECT 'D2_913_TWO_FLIGHTS_SUM8_CANONICAL_START_PENDING_MOVE_DENIAL_SAME_PLAN_APPLY_REPLAY_ROLLBACK_PASS';

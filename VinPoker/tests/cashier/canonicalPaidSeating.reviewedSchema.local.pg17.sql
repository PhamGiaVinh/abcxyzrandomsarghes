-- Owned reviewed-schema TEST. Requires main13/27/28, candidate113 and inert repo network support.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='20s';
DO $$ DECLARE
 actor uuid:=gen_random_uuid();club uuid:=gen_random_uuid();
 tour uuid;physical uuid;tt uuid;sess uuid;epoch bigint;hand uuid;button integer;seats integer[];
 player uuid;reg jsonb;r jsonb;first jsonb;replay jsonb;revision bigint;i integer;key text:=gen_random_uuid()::text;
 actors uuid[];entries integer[];
BEGIN
 ASSERT current_database()='vinpoker_ops_guard_main_20261028_v2';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55442;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-main-guards-20261028/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OPS_GUARD_MAIN_20261028_REVIEWED_SCHEMA_ONLY';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 INSERT INTO auth.users(id)VALUES(actor);
 INSERT INTO public.clubs(id,name,region,owner_id,status)VALUES(club,'Reviewed guard TEST','TEST',actor,'approved');
 INSERT INTO public.club_cashiers(club_id,user_id)VALUES(club,actor);
 INSERT INTO public.cashier_tour_settings(club_id,enabled)VALUES(club,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 PERFORM set_config('role','none',true);
 tour:=gen_random_uuid();
 INSERT INTO public.tournaments(id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,starting_stack,current_level,live_status)
 VALUES(tour,club,'Reviewed guard native TEST','active',clock_timestamp(),100000,0,0,20000,1,'registering');
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
 VALUES(tour,1,100,200,0,20,false);
 UPDATE public.game_tables SET table_number=1,operational_status='available' WHERE id=(SELECT id FROM public.game_tables WHERE club_id=club ORDER BY table_name,id LIMIT 1);
 PERFORM set_config('role','none',true);
 SELECT gt.id INTO STRICT physical FROM public.game_tables gt
 WHERE gt.club_id=club AND gt.status='inactive' AND gt.operational_status='available'
   AND NOT EXISTS (SELECT 1 FROM public.table_sessions ts WHERE ts.game_table_id=gt.id AND ts.closed_at IS NULL)
 ORDER BY gt.table_number,gt.id LIMIT 1 FOR UPDATE OF gt SKIP LOCKED;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_open_tournament_table_v3(tour,physical,'tracker',gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 r:=public.cashier_open_shift_v1(club,0);ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 SELECT id,table_session_id INTO STRICT tt,sess FROM public.tournament_tables WHERE tournament_id=tour AND game_table_id=physical;
 FOR i IN 1..3 LOOP
  player:=gen_random_uuid();INSERT INTO auth.users(id)VALUES(player);INSERT INTO public.profiles(user_id,display_name)VALUES(player,'D301 TEST '||player);
  PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  reg:=public.cashier_create_app_registration_v1(tour,player);ASSERT reg->>'ok'='true',reg::text;
  PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);PERFORM set_config('role','authenticated',true);
  r:=public.cashier_record_cash_buyin_v1((reg->>'registration_id')::uuid,100000,gen_random_uuid());ASSERT r->>'ok'='true',r::text;ASSERT r->>'seating_state'='seated',r::text;
  PERFORM set_config('role','none',true);
 END LOOP;

 ASSERT (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id=tour AND is_active);
 ASSERT (SELECT count(*)=3 AND sum(amount)=300000 FROM public.cashier_buyin_movements WHERE tournament_id=tour);
 ASSERT (SELECT table_id IS NULL AND game_table_id=physical FROM public.tournament_tables WHERE id=tt);
 ASSERT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced') p WHERE p.logical_id=tt AND p.physical_id=physical AND p.session_id=sess);
 BEGIN
  UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id=sess;
  ASSERT NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')),'closed_session_accepted';
  RAISE EXCEPTION USING ERRCODE='P1130';
 EXCEPTION WHEN SQLSTATE 'P1130' THEN NULL;END;
 BEGIN
  UPDATE public.tournament_tables SET status='closed' WHERE id=tt;
  ASSERT NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')),'closed_table_accepted';
  RAISE EXCEPTION USING ERRCODE='P1130';
 EXCEPTION WHEN SQLSTATE 'P1130' THEN NULL;END;
 BEGIN
  INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
  SELECT tour,tt,sess,n,'TEST held seat',actor FROM generate_series(1,9)n
  WHERE NOT EXISTS(SELECT 1 FROM public.tournament_seats s WHERE s.table_id=tt AND s.is_active AND s.seat_number=n);
  ASSERT NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')),'held_seat_accepted';
  RAISE EXCEPTION USING ERRCODE='P1130';
 EXCEPTION WHEN SQLSTATE 'P1130' THEN NULL;END;
 BEGIN
  INSERT INTO floor_private.table_mode_requests_v1(table_session_id,tournament_table_id,actor_id,target_mode,initial_epoch)
  SELECT sess,tt,actor,'manual',control_epoch FROM public.table_sessions WHERE id=sess;
  ASSERT NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')),'pending_mode_request_accepted';
  RAISE EXCEPTION USING ERRCODE='P1130';
 EXCEPTION WHEN SQLSTATE 'P1130' THEN NULL;END;
 ASSERT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'fill_lowest_table')),'positive_after_rollback_missing';
 ASSERT NOT has_function_privilege('authenticated','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE');
  SELECT control_epoch INTO STRICT epoch FROM public.table_sessions WHERE id=sess;
 SELECT min(seat_number) INTO button FROM public.tournament_seats WHERE tournament_id=tour AND is_active;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_start_tournament_clock(tour);ASSERT r->>'ok'='true',r::text;
 r:=public.start_tracker_hand_v3(tour,tt,sess,epoch,1,clock_timestamp(),actor,button);ASSERT r->>'status'='success',r::text;hand:=(r->>'hand_id')::uuid;

 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')),'active_hand_accepted';
 ASSERT (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id=tour AND is_active);
END $$;
ROLLBACK;
SELECT 'CASHIER113_CANONICAL_PAID_SEATS_CLOSED_HELD_MODE_ACTIVE_HAND_ACL_PASS';

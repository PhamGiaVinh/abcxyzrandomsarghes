\set ON_ERROR_STOP on
BEGIN;
\if :{?POOL253_CASE}
SELECT set_config('test.pool253',:'POOL253_CASE',true) AS test_case \gset
\else
SELECT set_config('test.pool253','date',true) AS test_case \gset
\endif
DO $$ DECLARE owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); club uuid:=gen_random_uuid(); other_club uuid:=gen_random_uuid();
 dealer uuid:=gen_random_uuid(); shift uuid:=gen_random_uuid(); checked_at timestamptz:='2026-10-01 00:30:00+07'; entered boolean; actual_date date; expected_date date;
 test_case text:=current_setting('test.pool253'); BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron')) THEN RAISE EXCEPTION 'isolated_pool253_only'; END IF;
 IF test_case NOT IN('date','current','club','ambiguous','overnight','closed','inactive','duplicate') THEN RAISE EXCEPTION 'unknown_pool253_case'; END IF;
 IF test_case='current' THEN checked_at:=statement_timestamp(); END IF;
 INSERT INTO auth.users(id) VALUES(owner_id),(other_owner);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Pool253 TEST','TEST','approved'),(other_club,other_owner,'Pool253 other TEST','TEST','approved');
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,club,'Pool253 TEST','08:00','23:00'),(gen_random_uuid(),other_club,'Other TEST','08:00','23:00');
 INSERT INTO public.dealers(id,club_id,full_name,status) VALUES(dealer,club,'Pool253 TEST dealer','active');
 IF test_case='ambiguous' THEN
  INSERT INTO public.dealer_shifts(club_id,tour_name,start_time,end_time) VALUES(club,'Second eligible TEST','12:00','23:00');
 END IF;
 expected_date:=(checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
 IF test_case='overnight' THEN
  UPDATE public.dealer_shifts SET start_time='20:00',end_time='04:00' WHERE id=shift;
  expected_date:=expected_date-1;
 END IF;
 IF test_case='closed' THEN UPDATE public.dealer_shifts SET closed_at=now() WHERE id=shift; END IF;
 IF test_case='inactive' THEN UPDATE public.dealers SET status='inactive' WHERE id=dealer; END IF;
 entered:=public._enter_dealer_pool(dealer,CASE WHEN test_case='club' THEN other_club ELSE club END,checked_at);
 IF test_case IN('date','current','overnight','duplicate') THEN
  SELECT shift_date INTO actual_date FROM public.dealer_attendance WHERE dealer_id=dealer;
  IF entered IS DISTINCT FROM true OR actual_date IS DISTINCT FROM expected_date THEN
   RAISE EXCEPTION 'POOL253_DATE expected%_from_trusted_pool_timestamp got% entered%',expected_date,actual_date,entered;
  END IF;
  IF test_case='duplicate' THEN
   ASSERT public._enter_dealer_pool(dealer,club,checked_at)=false;
   ASSERT (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id=dealer)=1;
  END IF;
 ELSE
  IF entered IS DISTINCT FROM false OR EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id=dealer) THEN
   RAISE EXCEPTION 'POOL253_% must_not_insert_or_pick_another_club_or_first_shift',upper(test_case);
  END IF;
 END IF;
 RAISE NOTICE 'POOL253_%_PASS',upper(test_case);
END $$;
ROLLBACK;

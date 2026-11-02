\set ON_ERROR_STOP on
CREATE TEMP TABLE bag632_before AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text) facts;
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_bag WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c');
 ASSERT NOT EXISTS(SELECT 1 FROM public.day_close WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress');
END $$;
-- CANDIDATE271
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
DO $$ DECLARE s public.table_sessions; n integer; r jsonb; p jsonb; tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';BEGIN
 SELECT * INTO STRICT s FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 ASSERT s.closed_at IS NULL AND s.control_mode='tracker';
 SELECT coalesce(max(hand_number),0)+1 INTO n FROM public.tournament_hands WHERE tournament_id=tour;
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3(tour,'d294f4a4-082b-4efc-a6ca-1f96579ea344',s.id,s.control_epoch,n,now(),auth.uid(),1);
 ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=tour AND hand_number=n AND status='in_progress');
 PERFORM set_config('role','authenticated',true);
 FOR p IN SELECT x FROM jsonb_array_elements(public.get_bag_tag_state(tour,1)->'players') x LOOP
  r:=public.chip_ops_record_bag(tour,1,(p->>'player_id')::uuid,'BAG632-'||(p->>'seat_number'),NULL,true);
  RAISE NOTICE 'BAG632_RECORD_DURING_ACTIVE_HAND %',r;
  IF current_setting('test.bag633_guard',true)='on' THEN ASSERT r->>'error'='HAND_IN_PROGRESS',r::text;END IF;
 END LOOP;
 r:=public.chip_ops_close_day(tour,1,0,false,NULL);
 IF current_setting('test.bag633_guard',true)='on' THEN ASSERT r->>'error'='HAND_IN_PROGRESS',r::text;END IF;
 IF r->>'status'='ok' THEN
  RAISE NOTICE 'BAG632_ACTIVE_HAND_DAY_CLOSED_RED %',r;
 ELSE RAISE NOTICE 'BAG632_CLOSE_BLOCKED %',r; END IF;
END $$;
RESET ROLE;
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT facts FROM bag632_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
END $$;
SELECT 'BAG632_DIAGNOSTIC_FULL_ROLLBACK_PASS_NOT_FEATURE_PASS';

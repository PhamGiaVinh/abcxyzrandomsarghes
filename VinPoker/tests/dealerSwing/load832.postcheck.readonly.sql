\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE b record;r jsonb;actual jsonb:='[]';name text;value jsonb;BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT b FROM private.load832_fixture WHERE id;
 ASSERT jsonb_array_length(b.manifest->'rows')=38;
 FOREACH name IN ARRAY ARRAY['tournament_entries','tournament_seats','tournament_hands','cashier_buyin_movements','tournament_prize_payments','chip_inventory_ledger','chip_bank_ledger','dealer_payroll','payroll_periods','club_settings','centerpoint_tournament_ops_release'] LOOP
  EXECUTE format('SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.%I x',name) INTO value;
  actual:=actual||jsonb_build_array(value);
 END LOOP;
 ASSERT md5(actual::text)=b.protected_hash,'832 changed financial/hand/entry/chip/payroll/flags';
 FOR r IN SELECT * FROM jsonb_array_elements(b.manifest->'rows') LOOP
  ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=(r->>'session')::uuid AND game_table_id=(r->>'physical')::uuid
   AND club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND session_type='cash' AND closed_at IS NULL);
  ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id=(r->>'attendance')::uuid AND dealer_id=(r->>'dealer')::uuid
   AND current_state='assigned' AND status='checked_in' AND check_out_time IS NULL AND check_in_time IS NOT NULL);
  ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE table_session_id=(r->>'session')::uuid
   AND attendance_id=(r->>'attendance')::uuid AND status='assigned' AND released_at IS NULL)=1;
 END LOOP;
 ASSERT (SELECT count(*) FROM public.table_sessions WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND closed_at IS NULL)=40;
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND status='assigned' AND released_at IS NULL)=40;
 ASSERT NOT EXISTS(SELECT table_session_id FROM public.dealer_assignments WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND status='assigned' AND released_at IS NULL GROUP BY table_session_id HAVING count(*)>1);
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='e5991944-e849-4e32-8076-fc1e4432587f' AND version=0 AND released_at IS NULL);
 ASSERT md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure))='09e3310fc3261a39cf05a6d44af14f3f';
END $$;
ROLLBACK;
SELECT 'LOAD832_40_EXACT_SESSIONS_ASSIGNMENTS_FINANCIAL_HAND_CHIP_PAYROLL_FLAGS_UNCHANGED_PASS';

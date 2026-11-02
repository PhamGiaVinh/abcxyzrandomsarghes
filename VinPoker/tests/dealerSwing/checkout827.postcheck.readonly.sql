\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE f jsonb;p jsonb;r jsonb;a public.dealer_attendance;worked integer; BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT manifest,proof INTO STRICT f,p FROM private.checkout827_fixture WHERE id;
 ASSERT f->>'club'='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND f->>'tour'='06ffb85a-a28d-4fd0-afd8-b480685b817c';
 ASSERT jsonb_array_length(p->'orders')=2 AND (SELECT bool_and((e->>'actual_lock')::boolean) FROM jsonb_array_elements(p->'orders')e);
 ASSERT p#>>'{orders,0,waiter,data,outcome}'='error' AND p#>>'{orders,0,waiter,data,detail}'='DEALER_ACQUISITION_ATTENDANCE_STALE';
 ASSERT p#>>'{orders,1,holder,outcome}'='swung' AND (p#>>'{orders,1,both_business_rolled_back}')::boolean;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=(p#>>'{orders,1,holder,new_assignment_id}')::uuid);
 SELECT * INTO STRICT a FROM public.dealer_attendance WHERE id=(f->>'first')::uuid;
 ASSERT a.status='checked_out' AND a.check_out_time IS NOT NULL;
 SELECT result INTO STRICT r FROM private.dealer_checkout_receipts_v1 WHERE attendance_id=a.id;
 ASSERT r=p#>'{orders,0,holder}';
 worked:=round(extract(epoch FROM(a.check_out_time-a.check_in_time))/60)::integer;
 ASSERT a.total_worked_minutes_today=worked AND a.overtime_minutes=0;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id=a.id AND released_at IS NULL AND status IN('assigned','on_break'));
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id=(f->>'second')::uuid AND status='checked_in' AND current_state='available' AND check_out_time IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM private.dealer_checkout_receipts_v1 WHERE attendance_id=(f->>'second')::uuid);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=(f->>'assignment')::uuid AND attendance_id=(f->>'outgoing')::uuid AND table_session_id=(f->>'session')::uuid
  AND status='assigned' AND released_at IS NULL AND version=(p->>'expected_version')::integer);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_breaks WHERE assignment_id=(f->>'assignment')::uuid);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=(f->>'session')::uuid AND game_table_id=(f->>'physical')::uuid AND closed_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_table_id=(f->>'table')::uuid AND status='active');
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id=(f->>'club')::uuid AND auto_swing_enabled);
END $$;
ROLLBACK;
SELECT 'CHECKOUT827_LOCK_SAFETY_PROOF_RETAINED_CHECKOUT_ONCE_REST_ROLLBACK_EXISTING_FALLBACK_ERROR_NOT_FEATURE_PASS';

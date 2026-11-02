\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01' AND closed_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a' AND current_state='available' AND status='checked_in');
END $$;
SELECT set_config('vinpoker.stale659_before',md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY request_key) FROM floor_private.dealer_initial_assign_receipts r),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01')
 )::text),true) IS NOT NULL;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; old_session uuid; BEGIN
 FOREACH old_session IN ARRAY ARRAY['0aab12d1-b855-4014-9f22-1dc59719c7e2'::uuid,'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'::uuid] LOOP
  result:=public.worker_assign_dealer_to_session_v1(
   p_club_id=>'d4427834-5f5f-48ef-bde5-e2dc388ed00b',p_table_id=>'29b12a26-6987-4bfa-810f-bfc64d13ef01',
   p_table_session_id=>old_session,p_attendance_id=>'6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a',
   p_swing_due_at=>clock_timestamp()+interval '45 minutes',p_idempotency_key=>'LOCAL659-stale-'||old_session::text);
  ASSERT result->>'outcome'='table_session_changed',result::text;
 END LOOP;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT current_setting('vinpoker.stale659_before')=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY request_key) FROM floor_private.dealer_initial_assign_receipts r),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01')
 )::text);
END $$;
ROLLBACK;
SELECT 'SINGLE659_ACTUAL_SERVICE_MANUAL_WORKER_OLD_CROSSLINKED_SESSION_DENIED_NO_DELTA_PASS';

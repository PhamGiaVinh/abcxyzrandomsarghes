\set ON_ERROR_STOP on
-- Exact retained journey, rollback only; no automatic Swing enable or history repair.
CREATE FUNCTION pg_temp.single638_facts(p_ignored_shift uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n text; j jsonb; facts jsonb:='{}';
BEGIN
 FOREACH n IN ARRAY ARRAY['dealer_attendance','dealer_assignments','dealer_shifts','game_tables','table_sessions','tournament_tables','tournament_entries','tournament_seats','cashier_buyin_movements','chip_inventory_ledger','club_settings','audit_logs','notifications','table_operation_receipts'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t%s',n,
   CASE WHEN n='dealer_shifts' THEN ' WHERE id IS DISTINCT FROM $1' ELSE '' END) INTO j USING p_ignored_shift;
  facts:=facts||jsonb_build_object(n,j);
 END LOOP;
 RETURN md5(facts::text);
END $$;
SELECT pg_temp.single638_facts() AS before \gset
BEGIN;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e')=8;
 ASSERT (SELECT shift_date FROM public.dealer_attendance WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0') < (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-1;
 ASSERT (SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b') IS NOT TRUE;
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL ROLE authenticated;
SELECT public.operator_check_in_dealer_v1('8c2270a7-1ba0-4f9f-80c2-75f34dfffbc4','d4427834-5f5f-48ef-bde5-e2dc388ed00b','dc91889f-0f73-4e2c-aaf1-d539a6072aed','e6380000-0000-4000-8000-000000000001')::text AS checkin \gset
RESET ROLE;
SELECT :'checkin' AS stale_checkin;
-- Explicit authorized manual intent through worker seam, not automatic execution.
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
\if :{?candidate272}
-- Synthetic CURRENT-DAY positive control inside a savepoint only. This is not
-- a real check-in or historical repair; original timestamps return below.
SAVEPOINT synthetic_current_day;
UPDATE public.dealer_attendance SET shift_date=(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,check_in_time=statement_timestamp()
 WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0';
DO $$ DECLARE r jsonb; assignment_id uuid; BEGIN
 r:=public.worker_assign_dealer_to_session_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','fefa250b-90b8-445a-8396-8c8d0317c8a0',statement_timestamp()+interval '30 minutes','single638-synthetic-current-day');
 ASSERT r->>'outcome'='ok',r::text;
 RAISE NOTICE 'SINGLE638_SYNTHETIC_CURRENT_DAY_POSITIVE_PASS';
 assignment_id:=(r->>'assignment_id')::uuid;
 BEGIN
  UPDATE public.dealer_assignments SET pre_assigned_attendance_id='d8539b3a-4376-47a6-be48-0be875f38687' WHERE id=assignment_id;
  RAISE EXCEPTION 'SINGLE638_STALE_INCOMING_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'DEALER_ACQUISITION_ATTENDANCE_STALE' THEN RAISE; END IF;
 END;
 ASSERT (SELECT pre_assigned_attendance_id IS NULL FROM public.dealer_assignments WHERE id=assignment_id);
 RAISE NOTICE 'SINGLE638_STALE_INCOMING_PREASSIGN_DENIED_PASS';
 -- Simulate a lifecycle crossing operating days. Release must remain possible;
 -- do not turn an acquisition-only fence into a historic cleanup blocker.
 UPDATE public.dealer_attendance SET shift_date='2026-10-21' WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0';
 UPDATE public.dealer_assignments SET status='completed',released_at=statement_timestamp(),release_reason='single638_rollback_only' WHERE id=assignment_id;
 ASSERT (SELECT released_at IS NOT NULL FROM public.dealer_assignments WHERE id=assignment_id);
 RAISE NOTICE 'SINGLE638_STALE_ASSIGNMENT_RELEASE_ALLOWED_PASS';
END $$;
ROLLBACK TO synthetic_current_day;
SAVEPOINT synthetic_overnight;
SET LOCAL timezone='UTC';
UPDATE public.dealer_shifts SET start_time='18:00',end_time='06:00' WHERE id='dc91889f-0f73-4e2c-aaf1-d539a6072aed';
UPDATE public.dealer_attendance SET shift_date='2026-10-23',check_in_time='2026-10-23 18:00:00+07' WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0';
DO $$ BEGIN
 ASSERT floor_private.dealer_pool_attendance_matches_v1('8c2270a7-1ba0-4f9f-80c2-75f34dfffbc4','d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-23 23:59:59+07');
 ASSERT floor_private.dealer_pool_attendance_matches_v1('8c2270a7-1ba0-4f9f-80c2-75f34dfffbc4','d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-24 05:59:59+07');
 ASSERT NOT floor_private.dealer_pool_attendance_matches_v1('8c2270a7-1ba0-4f9f-80c2-75f34dfffbc4','d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-24 06:00:00+07');
 ASSERT NOT floor_private.dealer_pool_attendance_matches_v1('8c2270a7-1ba0-4f9f-80c2-75f34dfffbc4','a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','2026-10-24 05:59:59+07');
 ASSERT NOT floor_private.dealer_pool_attendance_matches_v1('8c2270a7-1ba0-4f9f-80c2-75f34dfffbc4','d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-23 17:59:59+07');
 UPDATE public.dealer_shifts SET archived_at='2026-10-23 19:00:00+07' WHERE id='dc91889f-0f73-4e2c-aaf1-d539a6072aed';
 ASSERT NOT floor_private.dealer_pool_attendance_matches_v1('8c2270a7-1ba0-4f9f-80c2-75f34dfffbc4','d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-24 05:59:59+07');
 RAISE NOTICE 'SINGLE638_OVERNIGHT_UTC7_BOUNDARY_FOREIGN_CLUB_FUTURE_CHECKIN_ARCHIVED_DENIED_PASS';
END $$;
ROLLBACK TO synthetic_overnight;
SAVEPOINT synthetic_automatic;
SET LOCAL request.headers='{}';
UPDATE public.dealer_attendance SET shift_date=(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,check_in_time=statement_timestamp() WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0';
DO $$ DECLARE r jsonb; replay jsonb; BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron')),'no external dispatcher allowed in native test';
 BEGIN
  PERFORM public.worker_assign_dealer_to_session_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','fefa250b-90b8-445a-8396-8c8d0317c8a0',statement_timestamp()+interval '30 minutes','single640-auto-off');
  RAISE EXCEPTION 'SINGLE640_AUTO_OFF_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AUTO_SWING_OFF' THEN RAISE; END IF; END;
 UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 r:=public.worker_assign_dealer_to_session_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','fefa250b-90b8-445a-8396-8c8d0317c8a0',statement_timestamp()+interval '30 minutes','single640-auto-on');
 ASSERT r->>'outcome'='ok',r::text;
 UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 replay:=public.worker_assign_dealer_to_session_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','fefa250b-90b8-445a-8396-8c8d0317c8a0',statement_timestamp()+interval '30 minutes','single640-auto-on');
 ASSERT replay=r,'OFF must permit readback of existing receipt without new acquisition';
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE idempotency_key='single640-auto-on')=1;
 RAISE NOTICE 'SINGLE640_AUTO_OFF_DENIED_ON_ASSIGN_OFF_SAME_RECEIPT_NO_DUPLICATE_PASS';
END $$;
ROLLBACK TO synthetic_automatic;
\endif
SAVEPOINT assignment_probe;
DO $$ DECLARE r jsonb; BEGIN
 BEGIN
  r:=public.worker_assign_dealer_to_session_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','fefa250b-90b8-445a-8396-8c8d0317c8a0',statement_timestamp()+interval '30 minutes','single638-stale-attendance-diagnostic');
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'DEALER_ACQUISITION_ATTENDANCE_STALE' THEN RAISE; END IF;
  r:=jsonb_build_object('outcome','denied','error',SQLERRM);
 END;
 PERFORM set_config('single638.result',r::text,true);
END $$;
SELECT current_setting('single638.result') AS assignment \gset
SELECT :'assignment' AS stale_assignment;
ROLLBACK TO assignment_probe;
ROLLBACK;
SELECT pg_temp.single638_facts()=:'before' AS restored \gset
\if :restored
\echo SINGLE638_FOURTEEN_DOMAINS_FULL_ROLLBACK_PASS
\else
DO $$ BEGIN RAISE EXCEPTION 'SINGLE638_ROLLBACK_INVARIANT_FAILED'; END $$;
\endif
-- Assert after rollback, so the RED regression cannot leave mutated history.
SELECT coalesce(:'checkin'::jsonb->>'error'='previous_shift_open' AND :'assignment'::jsonb->>'error'='DEALER_ACQUISITION_ATTENDANCE_STALE',false) AS safe \gset
\if :safe
\echo SINGLE638_STALE_ATTENDANCE_DENIED_PASS
\else
\echo SINGLE638_RED_STALE_ASSIGNMENT_ACCEPTED_OR_CHECKIN_NOT_BLOCKED
DO $$ BEGIN RAISE EXCEPTION 'SINGLE638_EXPECTED_STALE_ASSIGNMENT_DENIAL'; END $$;
\endif

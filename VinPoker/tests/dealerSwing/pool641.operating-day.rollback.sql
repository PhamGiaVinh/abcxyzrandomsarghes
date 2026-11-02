\set ON_ERROR_STOP on
-- Candidate273 is injected after this marker, always inside the outer TX.
BEGIN;
-- POOL641_CANDIDATE_HERE
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT has_function_privilege('anon','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE');
 ASSERT has_function_privilege('service_role','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE');
END $$;
SET LOCAL request.jwt.claim.role='service_role';SET LOCAL ROLE service_role;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.get_dealer_pool_eligible_attendance_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b',ARRAY['fefa250b-90b8-445a-8396-8c8d0317c8a0','d8539b3a-4376-47a6-be48-0be875f38687']::uuid[]));
END $$;
RESET ROLE;
UPDATE public.dealer_attendance SET shift_date=(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,check_in_time=statement_timestamp() WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 ASSERT (SELECT array_agg(attendance_id) FROM public.get_dealer_pool_eligible_attendance_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b',ARRAY['fefa250b-90b8-445a-8396-8c8d0317c8a0','d8539b3a-4376-47a6-be48-0be875f38687']::uuid[]))=ARRAY['fefa250b-90b8-445a-8396-8c8d0317c8a0']::uuid[];
 ASSERT NOT EXISTS(SELECT 1 FROM public.get_dealer_pool_eligible_attendance_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',ARRAY['fefa250b-90b8-445a-8396-8c8d0317c8a0']::uuid[]));
END $$;
RESET ROLE;
UPDATE public.dealer_attendance SET shift_id='e6400000-0000-4000-8000-000000000001' WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.get_dealer_pool_eligible_attendance_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b',ARRAY['fefa250b-90b8-445a-8396-8c8d0317c8a0']::uuid[])),'fresh check-in must not hide committed child-shift close';
 BEGIN
  PERFORM public.get_dealer_pool_eligible_attendance_v1(NULL,ARRAY[]::uuid[]);
  RAISE EXCEPTION 'POOL641_NULL_CLUB_ACCEPTED';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.get_dealer_pool_eligible_attendance_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b',ARRAY[]::uuid[]);
  RAISE EXCEPTION 'POOL641_BROWSER_EXECUTE_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'POOL641_NATIVE_STALE_CURRENT_CLOSED_FOREIGNCLUB_ROLE_ROLLBACK_PASS';

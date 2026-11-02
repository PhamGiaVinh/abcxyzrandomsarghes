-- Existing linked Main Event only. No fixture, checkout, payroll save or policy write.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE
 sessions uuid[]:=ARRAY['c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55','0f8ed188-785b-4105-a8c2-6a93f6192f01',
 '9e586a50-61a8-440f-81df-27839c7ba81a','ca3c62fa-b4c5-4739-b571-5560dce53036','4bfd849b-8706-4799-9bea-f30fd1e08d8c']::uuid[];
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='4cd3af4d-7e1d-4042-855f-04fb6777e580'
   AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND status='completed');
 ASSERT (SELECT count(*) FROM public.table_sessions WHERE id=ANY(sessions) AND closed_at IS NOT NULL)=5;
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE table_session_id=ANY(sessions))=5;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id
   WHERE s.id=ANY(sessions) AND (a.status<>'completed' OR a.released_at IS DISTINCT FROM s.closed_at
    OR a.table_id<>s.game_table_id OR a.club_id<>s.club_id));
 ASSERT (SELECT count(DISTINCT table_session_id) FROM public.dealer_assignments
   WHERE table_session_id=ANY(sessions) AND table_id='96be0779-90f9-4851-9596-1d53f721c3c8')=2,
   'reused flight physical table has two separate closed session identities';
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id=ANY(sessions)
   AND (released_at IS NULL OR swing_in_progress OR pre_assigned_attendance_id IS NOT NULL));
 ASSERT (SELECT count(*) FROM public.dealer_attendance WHERE id=ANY(ARRAY[
   '158458a6-2264-4031-9629-9f4dc4c30e69','69513e94-dad6-47fb-997b-1690def39810',
   'c64a31b0-c78e-43fd-9c3a-2c2a4bb42795','3c1d8c23-a4ff-4be7-b078-e46c26d696ea']::uuid[])
   AND status='checked_in' AND current_state='available' AND check_out_time IS NULL
   AND total_worked_minutes_today=0 AND overtime_minutes=0)=4,
   'table close must not be misreported as a checkout or finalized time sheet';
 ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_payroll WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 ASSERT NOT (SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
END $$;
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
SELECT set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE result jsonb; row_data jsonb; dealer uuid; shift_data jsonb;
BEGIN
 result:=public.calculate_club_payroll('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','2026-10-01','2026-10-31');
 ASSERT result->>'club_id'='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 ASSERT result->>'period_start'='2026-10-01' AND result->>'period_end'='2026-10-31';
 -- There is an older independent dealer in this same TEST club: retain it, never
 -- trim the canonical payroll roster to only the four journey participants.
 ASSERT (SELECT count(*) FROM jsonb_object_keys(result->'dealers'))=5;
 FOREACH dealer IN ARRAY ARRAY['9b59a231-4377-4d70-a179-172baaca23dd','67e4f54a-84c5-42da-ac1e-5336f270d5a4',
   '9e817a04-955b-47a3-86f7-06e741d087ec','24803da6-62f3-4f42-af5b-7e8884e74171']::uuid[] LOOP
   row_data:=result->'dealers'->dealer::text;
   ASSERT row_data IS NOT NULL AND row_data->>'dealer_id'=dealer::text;
   ASSERT (row_data->>'total_shifts')::int=1;
   ASSERT (row_data->>'total_hours')::numeric=8 AND (row_data->>'ot_hours')::numeric=0,
     'existing open-shift standard estimate, NOT actual elapsed assignment time';
   ASSERT row_data->>'employment_type'='full_time' AND (row_data->>'monthly_salary_vnd')::numeric=0;
   ASSERT (row_data->>'gross_pay_vnd')::numeric=0 AND (row_data->>'net_pay_vnd')::numeric=0,
     'zero is explicit TEST salary configuration, not a transport fallback';
   ASSERT jsonb_array_length(row_data->'shifts')=1;
   shift_data:=row_data->'shifts'->0;
   ASSERT shift_data->>'check_out_time' IS NULL AND (shift_data->>'total_worked_minutes')::numeric=0;
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','ce8f0306-11e4-4f3b-95cb-351841e2df59',true);
SELECT set_config('request.jwt.claims','{"sub":"ce8f0306-11e4-4f3b-95cb-351841e2df59","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.calculate_club_payroll('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','2026-10-01','2026-10-31');
  RAISE EXCEPTION 'outsider payroll unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SELECT 'LINKED_MAIN_EVENT227_CLOSED_SESSIONS_RELEASED_OPEN_ATTENDANCE_ESTIMATE_OWNER_PREVIEW_OUTSIDER_DENIED_PASS';
ROLLBACK;

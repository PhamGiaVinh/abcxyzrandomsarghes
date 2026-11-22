\set ON_ERROR_STOP on
-- Disposable PostgreSQL only. Does not use play-chip, wager, or award writers.
\ir ../pending-migrations/20261119143438_online_satellite_pilot_registration.sql
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('ef100000-0000-4000-8000-000000000001'),
 ('ef100000-0000-4000-8000-000000000002'),
 ('ef100000-0000-4000-8000-000000000003'),
 ('ef100000-0000-4000-8000-000000000004'),
 ('ef100000-0000-4000-8000-000000000005'),
 ('ef100000-0000-4000-8000-000000000006'),
 ('ef100000-0000-4000-8000-000000000007');
INSERT INTO public.clubs(id,owner_id) VALUES
 ('ef200000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000001'),
 ('ef200000-0000-4000-8000-000000000002','ef100000-0000-4000-8000-000000000002');
INSERT INTO public.club_floors(club_id,user_id) VALUES
 ('ef200000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000003'),
 ('ef200000-0000-4000-8000-000000000002','ef100000-0000-4000-8000-000000000004');
INSERT INTO public.tournaments(id,club_id,name,start_time,buy_in,starting_stack) VALUES
 ('ef300000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001','Destination TEST A',now(),0,10000),
 ('ef300000-0000-4000-8000-000000000002','ef200000-0000-4000-8000-000000000002','Destination TEST B',now(),0,10000);
INSERT INTO public.club_members(club_id,player_user_id,member_card_id) VALUES
 ('ef200000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000005','TEST-5'),
 ('ef200000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000006','TEST-6'),
 ('ef200000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000007','TEST-7');
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
DO $test$
BEGIN
  IF has_schema_privilege('authenticated','online_satellite_private','USAGE')
     OR has_function_privilege('anon','public.register_online_satellite_pilot_v1(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'satellite private registration was exposed';
  END IF;
  IF public.can_create_online_satellite_pilot_v1('ef200000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'closed pilot gate advertised create authority';
  END IF;
  BEGIN
    PERFORM public.create_online_satellite_pilot_v1(
      'ef200000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000001',
      'ef900000-0000-4000-8000-000000000001',now()+interval '1 hour',10000,2);
    RAISE EXCEPTION 'pilot created while its registration gate was closed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'SATELLITE_PILOT_NOT_AVAILABLE' THEN RAISE; END IF;
  END;
END $test$;
RESET ROLE;

INSERT INTO online_satellite_private.registration_gate(club_id,enabled,delegated_td_actor_id,delegated_by)
VALUES ('ef200000-0000-4000-8000-000000000001',true,
 'ef100000-0000-4000-8000-000000000003','ef100000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_club uuid := 'ef200000-0000-4000-8000-000000000001';
  v_destination uuid := 'ef300000-0000-4000-8000-000000000001';
  v_request uuid := 'ef900000-0000-4000-8000-000000000001';
  v_cutoff timestamptz := now()+interval '1 hour';
  v_created jsonb;
  v_first jsonb;
  v_retry jsonb;
  v_view jsonb;
  v_pilot uuid;
BEGIN
  BEGIN
    PERFORM public.create_online_satellite_pilot_v1(v_club,'ef300000-0000-4000-8000-000000000002',v_request,v_cutoff,10000,2);
    RAISE EXCEPTION 'different club destination was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'SATELLITE_PILOT_DESTINATION_NOT_IN_CLUB' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000004',true);
  IF public.can_create_online_satellite_pilot_v1(v_club) THEN
    RAISE EXCEPTION 'other-club TD read create authority';
  END IF;
  BEGIN
    PERFORM public.create_online_satellite_pilot_v1(v_club,v_destination,v_request,v_cutoff,10000,2);
    RAISE EXCEPTION 'TD from another club created a pilot';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'SATELLITE_PILOT_MANAGER_REQUIRED' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000003',true);
  IF NOT public.can_create_online_satellite_pilot_v1(v_club) THEN
    RAISE EXCEPTION 'delegated TD did not receive create authority';
  END IF;
  v_created := public.create_online_satellite_pilot_v1(v_club,v_destination,v_request,v_cutoff,10000,2);
  v_pilot := (v_created->>'pilotId')::uuid;
  IF v_pilot IS NULL OR public.create_online_satellite_pilot_v1(
    v_club,v_destination,v_request,v_cutoff,10000,2) IS DISTINCT FROM v_created THEN
    RAISE EXCEPTION 'delegated TD could not replay the pilot receipt';
  END IF;
  PERFORM set_config('test.satellite_pilot_id',v_pilot::text,true);
  BEGIN
    PERFORM public.register_online_satellite_pilot_v1(v_pilot);
    RAISE EXCEPTION 'a TD without a linked membership enrolled';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'SATELLITE_PILOT_NOT_AVAILABLE' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_online_satellite_pilot_v1(v_pilot);
    RAISE EXCEPTION 'a TD without linked membership read player registration';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'SATELLITE_PILOT_NOT_AVAILABLE' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000005',true);
  v_view := public.get_online_satellite_pilot_v1(v_pilot);
  IF v_view->>'destinationName' IS DISTINCT FROM 'Destination TEST A'
    OR v_view->>'acceptingEntries' IS DISTINCT FROM 'true' OR v_view->>'entryId' IS NOT NULL THEN
    RAISE EXCEPTION 'the eligible player cannot verify the pilot before registration';
  END IF;
  v_first := public.register_online_satellite_pilot_v1(v_pilot);
  v_retry := public.register_online_satellite_pilot_v1(v_pilot);
  IF v_first->>'entryId' IS NULL OR v_first->>'idempotent' <> 'false'
    OR v_retry->>'entryId' IS DISTINCT FROM v_first->>'entryId' OR v_retry->>'idempotent' <> 'true' THEN
    RAISE EXCEPTION 'duplicate registration did not return the same entry';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000006',true);
  PERFORM public.register_online_satellite_pilot_v1(v_pilot);
  PERFORM set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000007',true);
  BEGIN
    PERFORM public.register_online_satellite_pilot_v1(v_pilot);
    RAISE EXCEPTION 'registration exceeded the single-table seat limit';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'SATELLITE_PILOT_FULL' THEN RAISE; END IF;
  END;
END $test$;
RESET ROLE;

UPDATE online_satellite_private.registration_gate SET enabled=false;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_pilot uuid := current_setting('test.satellite_pilot_id')::uuid;
BEGIN
  BEGIN
    PERFORM public.register_online_satellite_pilot_v1(v_pilot);
    RAISE EXCEPTION 'a new entry remained available after the switch was disabled';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'SATELLITE_PILOT_NOT_AVAILABLE' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000005',true);
  IF public.register_online_satellite_pilot_v1(v_pilot)->>'idempotent' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'disabling registration hid a committed entry receipt';
  END IF;
  IF public.get_online_satellite_pilot_v1(v_pilot)->>'entryId' IS NULL
    OR public.get_online_satellite_pilot_v1(v_pilot)->>'acceptingEntries' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'closed registration did not preserve the player view of their entry';
  END IF;
END $test$;
ROLLBACK;

-- Two real backend sessions submit the same account and pilot. The first
-- holds its transaction until another backend is observed waiting on it.
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO online_satellite_private.registration_gate(club_id,enabled)
VALUES ('ef200000-0000-4000-8000-000000000001',true);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',false);
SELECT set_config('test.satellite_race_pilot',public.create_online_satellite_pilot_v1(
  'ef200000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000001',
  'ef900000-0000-4000-8000-000000000002',now()+interval '1 hour',10000,2)->>'pilotId',false);
RESET ROLE;
DO $test$
DECLARE
  v_pilot uuid := current_setting('test.satellite_race_pilot')::uuid;
  v_query text := format('SELECT public.register_online_satellite_pilot_v1(%L)',v_pilot);
  v_session text;
  v_first_pid integer;
  v_second_pid integer;
  v_first jsonb;
  v_second jsonb;
  v_deadline timestamptz;
BEGIN
  FOREACH v_session IN ARRAY ARRAY['pilot-first','pilot-second'] LOOP
    PERFORM public.dblink_connect(v_session,'hostaddr=127.0.0.1 port=5432 dbname=postgres user=postgres connect_timeout=3');
    PERFORM public.dblink_exec(v_session,'BEGIN');
    PERFORM public.dblink_exec(v_session,'SET LOCAL statement_timeout = ''10s''');
    PERFORM public.dblink_exec(v_session,'SET LOCAL ROLE authenticated');
    PERFORM public.dblink_exec(v_session,'SET LOCAL request.jwt.claim.sub = ''ef100000-0000-4000-8000-000000000005''');
  END LOOP;
  SELECT pid INTO STRICT v_first_pid FROM public.dblink('pilot-first','SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO STRICT v_second_pid FROM public.dblink('pilot-second','SELECT pg_backend_pid()') AS t(pid integer);
  SELECT receipt INTO STRICT v_first FROM public.dblink('pilot-first',v_query) AS t(receipt jsonb);
  IF public.dblink_send_query('pilot-second',v_query) <> 1 THEN
    RAISE EXCEPTION 'second entry request did not start';
  END IF;
  v_deadline := clock_timestamp() + interval '5 seconds';
  WHILE NOT v_first_pid = ANY(pg_blocking_pids(v_second_pid)) LOOP
    IF clock_timestamp() >= v_deadline THEN
      RAISE EXCEPTION 'duplicate registration did not wait for the first transaction';
    END IF;
    PERFORM pg_sleep(0.02);
  END LOOP;
  PERFORM public.dblink_exec('pilot-first','COMMIT');
  SELECT receipt INTO STRICT v_second FROM public.dblink_get_result('pilot-second') AS t(receipt jsonb);
  PERFORM 1 FROM public.dblink_get_result('pilot-second') AS t(receipt jsonb);
  PERFORM public.dblink_exec('pilot-second','COMMIT');
  IF v_first->>'entryId' IS NULL OR v_second->>'entryId' IS DISTINCT FROM v_first->>'entryId'
    OR v_first->>'idempotent' IS DISTINCT FROM 'false'
    OR v_second->>'idempotent' IS DISTINCT FROM 'true'
    OR (SELECT count(*) FROM online_satellite_private.entries WHERE pilot_id=v_pilot) <> 1 THEN
    RAISE EXCEPTION 'the two competing requests did not preserve one entry';
  END IF;
  PERFORM public.dblink_disconnect('pilot-first');
  PERFORM public.dblink_disconnect('pilot-second');
  RAISE NOTICE 'Observed second Satellite request blocked and replayed the single committed entry';
END $test$;

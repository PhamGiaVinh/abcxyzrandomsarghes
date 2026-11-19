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

-- Local contract diagnostic, not a product fix or an end-to-end tour.
-- A repeated call has no request identity: report this gap, never label it fixed.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $guard$
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
   AND owner_id='675fe35e-60a8-4452-bb90-e79486d54da6');
END $guard$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
DO $test$
DECLARE
 before_events bigint; before_tours bigint; before_levels bigint;
 first_result jsonb; second_result jsonb; rejected_result jsonb;
 event_name text:='MAIN_EVENT162_ROLLBACK_ONLY_'||gen_random_uuid();
 actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 levels jsonb:='[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]';
BEGIN
 SELECT count(*) INTO before_events FROM public.tournament_events;
 SELECT count(*) INTO before_tours FROM public.tournaments;
 SELECT count(*) INTO before_levels FROM public.tournament_levels;
 PERFORM set_config('role','authenticated',true);
 -- Invalid shared blind data is consumed only after parent/final/flights writes.
 BEGIN
  PERFORM public.create_tournament_event_with_flights(
   'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',event_name,15,100000,0,20000,'nlh',20,6,2,
   '2026-10-22T12:00:00+07',NULL,
   '[{"level_number":"invalid-late-blind","big_blind":200}]'::jsonb);
  RAISE EXCEPTION 'main_event162_expected_late_blind_rejection';
 EXCEPTION WHEN invalid_text_representation THEN NULL;
 END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.tournament_events)=before_events,'partial parent survives';
 ASSERT (SELECT count(*) FROM public.tournaments)=before_tours,'partial children survive';
 ASSERT (SELECT count(*) FROM public.tournament_levels)=before_levels,'partial blinds survive';
 PERFORM set_config('role','authenticated',true);
 first_result:=public.create_tournament_event_with_flights(
  'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',event_name,15,100000,0,20000,'nlh',20,6,2,
  '2026-10-22T12:00:00+07',NULL,levels);
 second_result:=public.create_tournament_event_with_flights(
  'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',event_name,15,100000,0,20000,'nlh',20,6,2,
  '2026-10-22T12:00:00+07',NULL,levels);
 PERFORM set_config('role','none',true);
 ASSERT first_result->>'ok'='true' AND second_result->>'ok'='true';
 ASSERT first_result->>'event_id'<>second_result->>'event_id','retry diagnostic changed: investigate rather than weaken';
 ASSERT (SELECT count(*) FROM public.tournament_events)=before_events+2;
 ASSERT (SELECT count(*) FROM public.tournaments)=before_tours+6;
 ASSERT (SELECT count(*) FROM public.tournament_levels)=before_levels+6;
 ASSERT (SELECT count(*) FROM public.tournaments
  WHERE event_id=(first_result->>'event_id')::uuid AND phase='flight')=2;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_events e JOIN public.tournaments t
  ON t.id=e.final_tournament_id AND t.event_id=e.id AND t.phase='final'
  WHERE e.id=(first_result->>'event_id')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournaments
  WHERE event_id IN ((first_result->>'event_id')::uuid,(second_result->>'event_id')::uuid)
  AND live_status IS DISTINCT FROM 'registering'),'invalid initial child state';
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
  'sub',current_setting('request.jwt.claim.sub'))::text,true);
 PERFORM set_config('role','authenticated',true);
 rejected_result:=public.create_tournament_event_with_flights(
  'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',event_name,15,100000,0,20000,'nlh',20,6,2,
  '2026-10-22T12:00:00+07',NULL,levels);
 PERFORM set_config('role','none',true);
 ASSERT rejected_result->>'ok'='false' AND rejected_result->>'error'='actor_not_allowed';
 ASSERT (SELECT count(*) FROM public.tournament_events)=before_events+2,'denied actor wrote parent';
 ASSERT (SELECT count(*) FROM public.tournaments)=before_tours+6,'denied actor wrote children';
 RAISE NOTICE 'MAIN_EVENT162_ATOMIC_LATE_FAILURE_PASS_REPEATED_REQUEST_CREATES_TWO_EVENTS_REPRODUCED_NOT_FIXED';
END $test$;
ROLLBACK;
SELECT 'MAIN_EVENT162_ROLLED_BACK_NO_PERSISTED_TEST_EVENTS';

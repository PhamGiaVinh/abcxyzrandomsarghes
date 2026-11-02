-- Real native RPC/receipt regression. The surrounding caller rolls everything back.
DO $guard$
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441
  AND inet_server_addr()='127.0.0.1'::inet;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
END $guard$;
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $test$
DECLARE
 actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 key uuid:=gen_random_uuid(); config jsonb; levels jsonb; foreign_club uuid;
 original jsonb; replay jsonb; recovered jsonb; denied jsonb; conflict jsonb;
 events_before bigint; tours_before bigint; levels_before bigint; receipts_before bigint;
BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor);
 ASSERT NOT public.has_role(actor,'super_admin'::public.app_role),'owner-only fixture required for tenant denial';
 SELECT id INTO foreign_club FROM public.clubs WHERE owner_id<>actor ORDER BY id LIMIT 1;
 ASSERT foreign_club IS NOT NULL,'foreign-club fixture missing';
 config:=jsonb_build_object('name','MAIN_EVENT163_ROLLBACK_ONLY_'||key,'itm_percent',15,
  'buy_in',100000,'rake_amount',0,'starting_stack',20000,'game_type','nlh',
  'minutes_per_level',20,'late_reg_close_level',6,'flight_count',2,
  'final_start_time','2026-10-22T12:00:00+07',
  'flight_start_times',jsonb_build_array('2026-10-21T12:00:00+07','2026-10-21T18:00:00+07'));
 levels:='[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]';
 SELECT count(*) INTO events_before FROM public.tournament_events;
 SELECT count(*) INTO tours_before FROM public.tournaments;
 SELECT count(*) INTO levels_before FROM public.tournament_levels;
 SELECT count(*) INTO receipts_before FROM public.table_operation_receipts;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 original:=public.create_tournament_event_with_flights_v2(club,config,levels,key,actor);
 ASSERT original->>'ok'='true',original::text;
 replay:=public.create_tournament_event_with_flights_v2(club,config,levels,key,actor);
 ASSERT replay=original,'same request created a different event';
 recovered:=public.get_tournament_event_create_receipt_v1(club,config,levels,key,actor);
 ASSERT recovered=original,'receipt recovery differs';
 conflict:=public.create_tournament_event_with_flights_v2(club,config||'{"flight_count":3}',levels,key,actor);
 ASSERT conflict->>'error'='IDEMPOTENCY_CONFLICT','same key accepted different config';
 conflict:=public.get_tournament_event_create_receipt_v1(club,config,levels||levels,key,actor);
 ASSERT conflict->>'error'='IDEMPOTENCY_CONFLICT','receipt accepted different levels';
 denied:=public.create_tournament_event_with_flights_v2(club,config,levels,gen_random_uuid(),gen_random_uuid());
 ASSERT denied->>'error'='actor_changed','expected actor ignored';
 denied:=public.create_tournament_event_with_flights_v2(foreign_club,config,levels,key,actor);
 ASSERT denied->>'error'='actor_not_allowed','foreign club create allowed';
 denied:=public.get_tournament_event_create_receipt_v1(foreign_club,config,levels,key,actor);
 ASSERT denied->>'error'='actor_not_allowed','foreign club receipt exposed';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.tournament_events)=events_before+1;
 ASSERT (SELECT count(*) FROM public.tournaments)=tours_before+3;
 ASSERT (SELECT count(*) FROM public.tournament_levels)=levels_before+3;
 ASSERT (SELECT count(*) FROM public.table_operation_receipts)=receipts_before+1;
 ASSERT original->>'actor_id'=actor::text AND original->>'club_id'=club::text
  AND original->>'request_id'=key::text AND original->>'flight_count'='2'
  AND original->>'level_count'='1';
 ASSERT (SELECT count(*) FROM public.tournaments WHERE event_id=(original->>'event_id')::uuid
  AND live_status='registering')=3;
 -- A late blind failure must not leave a parent, child or receipt.
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.create_tournament_event_with_flights_v2(club,config,
   '[{"level_number":"invalid-late-level"}]',gen_random_uuid(),actor);
  RAISE EXCEPTION 'expected blind failure';
 EXCEPTION WHEN invalid_text_representation THEN NULL; END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.tournament_events)=events_before+1;
 ASSERT (SELECT count(*) FROM public.tournaments)=tours_before+3;
 ASSERT (SELECT count(*) FROM public.table_operation_receipts)=receipts_before+1;
 -- Current authority, not knowledge of an old actor/key, gates recovery.
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
  'sub',current_setting('request.jwt.claim.sub'))::text,true);
 PERFORM set_config('role','authenticated',true);
 denied:=public.get_tournament_event_create_receipt_v1(club,config,levels,key,actor);
 ASSERT denied->>'error'='actor_changed';
 denied:=public.create_tournament_event_with_flights_v2(club,config,levels,key,
  current_setting('request.jwt.claim.sub')::uuid);
 ASSERT denied->>'error'='actor_not_allowed';
 PERFORM set_config('role','none',true);
 ASSERT NOT has_function_privilege('anon','public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.get_tournament_event_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE');
 RAISE NOTICE 'MAIN_EVENT163_SAME_KEY_RECEIPT_CONFLICT_ACTOR_TENANT_ATOMICITY_PASS';
END $test$;

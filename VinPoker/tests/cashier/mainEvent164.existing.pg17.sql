-- Transaction-only qualification of current Main Event config persistence.
DO $guard$
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441 AND inet_server_addr()='127.0.0.1'::inet;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
END $guard$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION pg_temp.main_event164_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.description='LOCAL_FAIL_AFTER_EVENT_GTD' THEN RAISE EXCEPTION 'main_event164_late_metadata_failure' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER main_event164_late_failure BEFORE UPDATE OF description ON public.tournaments
 FOR EACH ROW EXECUTE FUNCTION pg_temp.main_event164_late_failure();
DO $test$
DECLARE
 actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6'; club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 key uuid:=gen_random_uuid(); result jsonb; repeated jsonb; config jsonb; bad jsonb;
 levels jsonb:='[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]';
 events_before bigint; receipts_before bigint; tours_before bigint;
BEGIN
 config:=jsonb_build_object('name','MAIN_EVENT164_ROLLBACK_ONLY_'||key,'itm_percent',15,
  'buy_in',100000,'rake_amount',10000,'starting_stack',20000,'game_type','nlh',
  'minutes_per_level',20,'late_reg_close_level',6,'flight_count',2,'final_start_time','2026-10-22T12:00:00+07',
  'service_fee_amount',5000,'guarantee_amount',2500000,'location','TEST room A','description','Two TEST flights and a final');
 SELECT count(*) INTO events_before FROM public.tournament_events;
 SELECT count(*) INTO receipts_before FROM public.table_operation_receipts;
 SELECT count(*) INTO tours_before FROM public.tournaments;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 result:=public.create_tournament_event_with_flights_v2(club,config,levels,key,actor);
 ASSERT result->>'ok'='true',result::text;
 repeated:=public.create_tournament_event_with_flights_v2(club,config,levels,key,actor);
 ASSERT repeated=result;
 repeated:=public.create_tournament_event_with_flights_v2(club,config||'{"service_fee_amount":6000}',levels,key,actor);
 ASSERT repeated->>'error'='IDEMPOTENCY_CONFLICT';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.tournaments WHERE event_id=(result->>'event_id')::uuid
  AND service_fee_amount=5000 AND buy_in=100000 AND rake_amount=10000
  AND location='TEST room A' AND description='Two TEST flights and a final')=3,'visible config was lost';
 ASSERT (SELECT guarantee_amount FROM public.tournament_events WHERE id=(result->>'event_id')::uuid)=2500000,'event GTD lost';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournaments WHERE event_id=(result->>'event_id')::uuid
  AND guarantee_amount IS NOT NULL),'event GTD copied to a child';
 ASSERT (SELECT count(*) FROM public.tournament_events)=events_before+1;
 ASSERT (SELECT count(*) FROM public.table_operation_receipts)=receipts_before+1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_registrations r JOIN public.tournaments t ON t.id=r.tournament_id WHERE t.event_id=(result->>'event_id')::uuid);
 FOREACH bad IN ARRAY ARRAY['{"service_fee_amount":-1}','{"service_fee_amount":0.5}',
  '{"service_fee_amount":null}','{"service_fee_amount":"5000"}','{"location":7}','{"description":{}}',
  '{"guarantee_amount":-1}','{"guarantee_amount":0.5}','{"guarantee_amount":"2500000"}']::jsonb[] LOOP
  PERFORM set_config('role','authenticated',true);
  repeated:=public.create_tournament_event_with_flights_v2(club,config||bad,levels,gen_random_uuid(),actor);
  ASSERT repeated->>'ok'='false','invalid config accepted';
  PERFORM set_config('role','none',true);
 END LOOP;
 ASSERT (SELECT count(*) FROM public.tournament_events)=events_before+1,'invalid config left parents';
 ASSERT (SELECT count(*) FROM public.table_operation_receipts)=receipts_before+1,'invalid config left receipts';
 PERFORM set_config('role','authenticated',true);
 repeated:=public.create_tournament_event_with_flights_v2(club,config||'{"guarantee_amount":2600000}',levels,key,actor);
 ASSERT repeated->>'error'='IDEMPOTENCY_CONFLICT','same key accepted a different GTD';
 BEGIN
  PERFORM public.create_tournament_event_with_flights_v2(club,config||'{"description":"LOCAL_FAIL_AFTER_EVENT_GTD"}',levels,gen_random_uuid(),actor);
  RAISE EXCEPTION 'expected late metadata rejection';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='main_event164_late_metadata_failure'; END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.tournament_events)=events_before+1,'late failure retained event/GTD';
 ASSERT (SELECT count(*) FROM public.tournaments)=tours_before+3,'late failure retained children';
 ASSERT (SELECT count(*) FROM public.table_operation_receipts)=receipts_before+1,'late failure retained receipt';
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 WHERE event_id='b8ebfbc7-ff78-4515-8812-7d748b828d0b');
 BEGIN
  UPDATE public.tournament_events SET guarantee_amount=1 WHERE id='b8ebfbc7-ff78-4515-8812-7d748b828d0b';
  RAISE EXCEPTION 'expected frozen event GTD rejection';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='main_event_guarantee_frozen'; END;
 RAISE NOTICE 'MAIN_EVENT164_SHARED_FEE_METADATA_REPLAY_VALIDATION_PASS_NO_PAYMENTS';
END $test$;

-- Native rollback-only regression on the named owned candidate race clone.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_rules_race_20261029';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RULES_RACE_20261029_OWNED_LOCAL_TEST';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='multi_day_entry_rules_fence_v1' AND tgrelid='public.tournament_entries'::regclass);
END $$;
DO $$
DECLARE actor constant uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 club constant uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 event constant uuid:='650c1ae7-4ed9-4465-a546-5648aabdafb1';
 physical_a constant uuid:='f7290000-0000-4000-8000-000000000021';
 physical_b constant uuid:='f7290000-0000-4000-8000-000000000022';
 tour uuid; players uuid[]; player uuid; registered jsonb; paid jsonb; replay jsonb; opened jsonb;
 intent jsonb; request uuid; table_a uuid; table_b uuid; seat_a integer; seat_b integer;
 first_player boolean:=true; rejected jsonb;
BEGIN
 ASSERT public.is_club_cashier(actor,club),'existing fixture actor lacks cashier capability';
 ASSERT public.cashier_tour_active_v1(club),'cashier not enabled for fixture';
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 WHERE event_id=event);
 SELECT id INTO STRICT tour FROM public.tournaments WHERE event_id=event AND phase='flight' ORDER BY flight_label LIMIT 1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id=tour);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=tour);
 SELECT array_agg(id ORDER BY id) INTO players FROM(
  SELECT DISTINCT u.id FROM auth.users u JOIN public.tournament_entries e ON e.player_id=u.id
  WHERE e.tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND u.id<>actor ORDER BY u.id LIMIT 8)x;
 ASSERT array_length(players,1)=8,'requires eight existing fixture users';
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 (physical_a,club,'Paid rules A local TEST',97,'tournament','inactive','available'),
 (physical_b,club,'Paid rules B local TEST',98,'tournament','inactive','available');
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY[club] WHERE id;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3(tour,physical_a,'manual',gen_random_uuid());
 ASSERT opened->>'ok'='true',opened::text;table_a:=(opened->>'tournament_table_id')::uuid;
 opened:=public.floor_open_tournament_table_v3(tour,physical_b,'manual',gen_random_uuid());
 ASSERT opened->>'ok'='true',opened::text;table_b:=(opened->>'tournament_table_id')::uuid;
 FOREACH player IN ARRAY players LOOP
  PERFORM set_config('role','none',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('role','service_role',true);
  registered:=public.cashier_create_app_registration_v1(tour,player);
  ASSERT registered->>'ok'='true' AND registered->>'already_registered'='false',registered::text;
  ASSERT (registered->>'total_pay')::bigint=115000,registered::text;
  ASSERT registered->'price_snapshot' @> '{"buy_in":100000,"rake":10000,"service_fee":5000,"platform_fee":0}'::jsonb;
  request:=gen_random_uuid();
  intent:=jsonb_build_object('actor_id',actor,'club_id',club,'tournament_id',tour,
    'registration_id',registered->>'registration_id','amount',115000,'request_id',request);
  PERFORM set_config('role','none',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  PERFORM set_config('role','authenticated',true);
  IF first_player THEN
   rejected:=public.resolve_cashier_cash_buyin_intent_v1(
    intent||jsonb_build_object('amount',115001,'request_id',gen_random_uuid()),'record');
   ASSERT rejected->>'status'='rejected' AND rejected->'result'->>'error'='amount_exceeds_remaining',rejected::text;
  END IF;
  paid:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
  ASSERT paid->>'ok'='true' AND paid->>'status'='recorded',paid::text;
  replay:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
  ASSERT replay=paid,'cash retry changed receipt';
  replay:=public.resolve_cashier_cash_buyin_intent_v1(intent,'read');
  ASSERT replay=paid,'cash read failed to verify exact receipt';
  IF first_player THEN
   rejected:=public.resolve_cashier_cash_buyin_intent_v1(intent||'{"amount":1}'::jsonb,'record');
   ASSERT rejected->>'error'='IDEMPOTENCY_CONFLICT',rejected::text;
   rejected:=public.resolve_cashier_cash_buyin_intent_v1(intent||jsonb_build_object('request_id',gen_random_uuid()),'record');
   ASSERT rejected->>'status'='rejected' AND rejected->'result'->>'error'='registration_not_pending',rejected::text;
   first_player:=false;
  END IF;
 END LOOP;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id=tour AND status='confirmed')=8;
 ASSERT (SELECT sum(total_pay) FROM public.tournament_registrations WHERE tournament_id=tour)=920000;
 ASSERT (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=tour)=8;
 ASSERT (SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id=tour)=920000;
 ASSERT (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=tour)=920000;
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id=tour AND status='seated')=8;
 ASSERT (SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=tour)=160000;
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_id=tour AND is_active)=8;
 ASSERT (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id=tour AND is_active)=160000;
 SELECT count(*) INTO seat_a FROM public.tournament_seats WHERE tournament_table_id=table_a AND is_active;
 SELECT count(*) INTO seat_b FROM public.tournament_seats WHERE tournament_table_id=table_b AND is_active;
 ASSERT seat_a=4 AND seat_b=4,format('expected 4/4 balanced seats, got %s/%s',seat_a,seat_b);
 RAISE NOTICE 'EIGHT_PAID_MAIN_FLIGHT_TWO_TABLES_BALANCED_NATIVE_PASS';
END $$;

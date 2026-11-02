\set ON_ERROR_STOP on
-- Explicit TEST identity metadata; never seed registrations, money or seats.
BEGIN;
DO $$ DECLARE saved jsonb; players uuid[]; person uuid; n integer; BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'))
 THEN RAISE EXCEPTION 'isolated_clean249_only'; END IF;
 SELECT fixture INTO STRICT saved FROM public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682 FOR UPDATE;
 IF saved->>'tour'<>'c367013a-3ed3-48af-ad48-3915acadc50e'
 OR saved ? 'players'
 OR (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e')<>1
 OR NOT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='df79ea5e-ef9f-4ef6-a27c-ed53d5486a67' AND status='pending' AND total_pay=100000)
 OR EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e')
 OR NOT EXISTS(SELECT 1 FROM public.stack_template_issuance WHERE stack_template_id='ae128140-48dc-4773-8c96-87a6e0d90219' AND issued_count=8 AND revision=1)
 THEN RAISE EXCEPTION 'fresh_metadata_on_exact_first_pending_only'; END IF;
 players:=ARRAY[(saved->>'player')::uuid];
 FOR n IN 2..8 LOOP
  person:=gen_random_uuid();
  INSERT INTO auth.users(id) VALUES(person);
  INSERT INTO public.profiles(user_id,display_name) VALUES(person,'Clean R11 TEST player '||n);
  players:=array_append(players,person);
 END LOOP;
 UPDATE public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682
 SET fixture=fixture||jsonb_build_object('players',to_jsonb(players));
END $$;
COMMIT;
SELECT jsonb_build_object('players',fixture->'players','registrations',
 (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e'))
FROM public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682;

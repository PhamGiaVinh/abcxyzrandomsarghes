\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE owner_id uuid:=gen_random_uuid(); club uuid:=gen_random_uuid(); n integer; physical uuid; result jsonb; tour uuid; BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr()<>'127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron')) THEN RAISE EXCEPTION 'isolated_pool250_only'; END IF;
 INSERT INTO auth.users(id) VALUES(owner_id);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Canonical pool250 TEST','TEST','approved');
 SELECT count(*) INTO n FROM public.game_tables WHERE club_id=club AND table_number BETWEEN 1 AND 100
  AND table_type='tournament' AND game_type='NLH' AND status='inactive' AND operational_status='available' AND shift_id IS NULL;
 IF n<>100 THEN RAISE EXCEPTION 'NEW_CLUB_CANONICAL_POOL expected100 got%',n; END IF;
 IF (SELECT count(*) FROM public.game_tables WHERE club_id=club)<>100
 OR (SELECT count(DISTINCT table_number) FROM public.game_tables WHERE club_id=club)<>100
 OR EXISTS(SELECT 1 FROM public.table_sessions WHERE club_id=club) THEN RAISE EXCEPTION 'pool_count_or_implicit_open'; END IF;
 INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES(club,owner_id);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true);
 PERFORM set_config('role','authenticated',true);
 SELECT count(*) INTO n FROM public.get_club_table_inventory(club);
 IF n<>100 THEN RAISE EXCEPTION 'pool_inventory_read_count_%',n; END IF;
 result:=public.create_tournament_with_levels_v1(club,jsonb_build_object('name','Pool250 tour TEST','start_time',now()+interval '1 hour',
  'buy_in',100000,'rake_amount',0,'service_fee_amount',0,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
  '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),owner_id);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pool_create_%',result; END IF;
 tour:=(result->>'tournament_id')::uuid;
 SELECT id INTO physical FROM public.game_tables WHERE club_id=club AND table_number=30;
 result:=public.floor_open_tournament_table_v3(tour,physical,'manual',gen_random_uuid());
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pool_open_%',result; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.table_sessions WHERE club_id=club AND closed_at IS NULL)<>1
 OR (SELECT count(*) FROM public.dealer_assignments WHERE table_id=physical AND status='active')<>0
 THEN RAISE EXCEPTION 'pool_open_lifecycle_or_auto_assign'; END IF;
 RAISE NOTICE 'NEW_CLUB_CANONICAL_POOL_INVENTORY_OPEN_NO_IMPLICIT_DEALER_PASS';
END $$;
ROLLBACK;

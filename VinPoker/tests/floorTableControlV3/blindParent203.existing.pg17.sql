BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c19ee5c2-68c7-4627-842a-06a3a2348d6f' AND name='Tour edit121 partial local TEST config committed')
 THEN RAISE EXCEPTION 'blind203_exact_local_fixture';END IF;
END $$;
DO $test$ DECLARE tour uuid:='c19ee5c2-68c7-4627-842a-06a3a2348d6f';club uuid:='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2';owner_id uuid:='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
 actor uuid;member_table text;role_name text;levels jsonb;r jsonb;before_rows jsonb;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('level_number',level_number,'small_blind',small_blind,'big_blind',big_blind,'ante',ante,'duration_minutes',duration_minutes,'is_break',is_break) ORDER BY level_number) INTO levels FROM public.tournament_levels WHERE tournament_id=tour;
 IF jsonb_array_length(levels)<>2 THEN RAISE EXCEPTION 'blind203_fixture_levels';END IF;
 FOREACH member_table IN ARRAY ARRAY['club_cashiers','club_trackers','club_dealer_controls'] LOOP
  actor:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(actor);
  EXECUTE format('INSERT INTO public.%I(club_id,user_id,granted_by) VALUES($1,$2,$3)',member_table) USING club,actor,owner_id;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  PERFORM set_config('role','authenticated',true);
  r:=public.update_blind_structure(tour,levels);
  IF r->>'status' IS DISTINCT FROM 'success' OR (r->>'levels_saved')::integer<>2 THEN RAISE EXCEPTION 'blind203_existing_role_lost_% %',member_table,r;END IF;
  BEGIN
   PERFORM public._lock_tournament_blind_parent_v1('46cab483-91e7-4220-aacf-e17bdf05269c');
   RAISE EXCEPTION 'blind203_cross_club_should_fail';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'blind_parent_actor_not_allowed' THEN RAISE;END IF;END;
  PERFORM set_config('role','none',true);
 END LOOP;
 actor:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(actor);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 BEGIN PERFORM public.update_blind_structure(tour,levels);RAISE EXCEPTION 'blind203_outsider_should_fail';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'blind_parent_actor_not_allowed' THEN RAISE;END IF;END;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 BEGIN PERFORM public._lock_tournament_blind_parent_v1(tour);RAISE EXCEPTION 'blind203_null_actor_should_fail';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'blind_parent_actor_not_allowed' THEN RAISE;END IF;END;
 PERFORM set_config('role','none',true);
 FOREACH role_name IN ARRAY ARRAY['anon','service_role'] LOOP
  IF has_function_privilege(role_name,'public._lock_tournament_blind_parent_v1(uuid)','EXECUTE') THEN RAISE EXCEPTION 'blind203_helper_acl_%',role_name;END IF;
  BEGIN
   PERFORM set_config('role',role_name,true);PERFORM public._lock_tournament_blind_parent_v1(tour);
   RAISE EXCEPTION 'blind203_helper_call_should_fail_%',role_name;
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  PERFORM set_config('role','none',true);
 END LOOP;
 IF NOT has_function_privilege('authenticated','public._lock_tournament_blind_parent_v1(uuid)','EXECUTE')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure)
 OR (SELECT NOT relrowsecurity FROM pg_class WHERE oid='public.tournament_levels'::regclass)
 THEN RAISE EXCEPTION 'blind203_invoker_or_rls_changed';END IF;
 SELECT jsonb_agg(to_jsonb(l) ORDER BY id) INTO before_rows FROM public.tournament_levels l WHERE tournament_id=tour;
 EXECUTE $ddl$CREATE FUNCTION public.test_blind203_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$
 BEGIN IF NEW.tournament_id='c19ee5c2-68c7-4627-842a-06a3a2348d6f' THEN RAISE EXCEPTION 'TEST_BLIND203_INSERT_FAILURE';END IF;RETURN NEW;END $fn$;$ddl$;
 EXECUTE 'CREATE TRIGGER test_blind203_insert_failure BEFORE INSERT ON public.tournament_levels FOR EACH ROW EXECUTE FUNCTION public.test_blind203_insert_failure()';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true);
 BEGIN
  PERFORM set_config('role','authenticated',true);PERFORM public.update_blind_structure(tour,levels);
  RAISE EXCEPTION 'blind203_expected_insert_failure_missing';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TEST_BLIND203_INSERT_FAILURE' THEN RAISE;END IF;END;
 PERFORM set_config('role','none',true);
 IF (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id=tour) IS DISTINCT FROM before_rows
 THEN RAISE EXCEPTION 'blind203_insert_failure_left_partial_levels';END IF;
 EXECUTE 'DROP TRIGGER test_blind203_insert_failure ON public.tournament_levels';EXECUTE 'DROP FUNCTION public.test_blind203_insert_failure()';
END $test$;
ROLLBACK;
SELECT 'BLIND203_OWNER_CASHIER_TRACKER_DEALER_AUTH_TENANT_FAULT_ROLLBACK_PASS';

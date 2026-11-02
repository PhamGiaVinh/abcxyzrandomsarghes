BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c19ee5c2-68c7-4627-842a-06a3a2348d6f' AND name='Tour edit121 partial local TEST config committed')
 THEN RAISE EXCEPTION 'blind204_exact_local_fixture';END IF;
END $$;
DO $test$ DECLARE tour uuid:='c19ee5c2-68c7-4627-842a-06a3a2348d6f';club uuid:='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2';owner_id uuid:='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
 actor uuid;member_table text;writer text;levels jsonb;r jsonb;csv text;before_rows jsonb;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('level_number',level_number,'small_blind',small_blind+1,'big_blind',big_blind,'ante',ante,'duration_minutes',duration_minutes,'is_break',is_break) ORDER BY level_number) INTO levels FROM public.tournament_levels WHERE tournament_id=tour;
 SELECT string_agg(concat(l->>'small_blind',',',l->>'big_blind',',',l->>'ante',',',l->>'duration_minutes',',',l->>'is_break'),E'\n' ORDER BY n) INTO csv FROM jsonb_array_elements(levels) WITH ORDINALITY AS x(l,n);
 FOREACH member_table IN ARRAY ARRAY['club_cashiers','club_trackers','club_dealer_controls'] LOOP
  actor:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(actor);
  EXECUTE format('INSERT INTO public.%I(club_id,user_id,granted_by) VALUES($1,$2,$3)',member_table) USING club,actor,owner_id;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);PERFORM set_config('role','authenticated',true);
  r:=public.import_blind_structure(tour,csv);
  IF r->>'status' IS DISTINCT FROM 'success' OR (r->>'levels_imported')::integer<>2 THEN RAISE EXCEPTION 'blind204_import_existing_role_lost_% %',member_table,r;END IF;
  r:=public.update_tournament_blinds(tour,levels);
  IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'blind204_upsert_existing_role_lost_% %',member_table,r;END IF;
  FOREACH writer IN ARRAY ARRAY['import','upsert'] LOOP
   BEGIN
    IF writer='import' THEN PERFORM public.import_blind_structure('46cab483-91e7-4220-aacf-e17bdf05269c',csv);
    ELSE PERFORM public.update_tournament_blinds('46cab483-91e7-4220-aacf-e17bdf05269c',levels);END IF;
    RAISE EXCEPTION 'blind204_cross_club_should_fail';
   EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'blind_parent_actor_not_allowed' THEN RAISE;END IF;END;
  END LOOP;
  PERFORM set_config('role','none',true);
 END LOOP;
 actor:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(actor);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);PERFORM set_config('role','authenticated',true);
 FOREACH writer IN ARRAY ARRAY['import','upsert'] LOOP
  BEGIN
   IF writer='import' THEN PERFORM public.import_blind_structure(tour,csv);ELSE PERFORM public.update_tournament_blinds(tour,levels);END IF;
   RAISE EXCEPTION 'blind204_outsider_should_fail';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'blind_parent_actor_not_allowed' THEN RAISE;END IF;END;
 END LOOP;
 PERFORM set_config('role','none',true);
 SELECT jsonb_agg(to_jsonb(l) ORDER BY id) INTO before_rows FROM public.tournament_levels l WHERE tournament_id=tour;
 levels:=jsonb_set(levels,'{0,small_blind}',to_jsonb((levels#>>'{0,small_blind}')::integer+1));
 SELECT string_agg(concat(l->>'small_blind',',',l->>'big_blind',',',l->>'ante',',',l->>'duration_minutes',',',l->>'is_break'),E'\n' ORDER BY n) INTO csv FROM jsonb_array_elements(levels) WITH ORDINALITY AS x(l,n);
 EXECUTE $ddl$CREATE FUNCTION public.test_blind204_second_row_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$
 BEGIN IF NEW.tournament_id='c19ee5c2-68c7-4627-842a-06a3a2348d6f' AND NEW.level_number=2 THEN RAISE EXCEPTION 'TEST_BLIND204_SECOND_ROW_FAILURE';END IF;RETURN NEW;END $fn$;$ddl$;
 EXECUTE 'CREATE TRIGGER test_blind204_second_row_failure BEFORE INSERT ON public.tournament_levels FOR EACH ROW EXECUTE FUNCTION public.test_blind204_second_row_failure()';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true);
 FOREACH writer IN ARRAY ARRAY['import','upsert'] LOOP
  BEGIN
   PERFORM set_config('role','authenticated',true);
   IF writer='import' THEN PERFORM public.import_blind_structure(tour,csv);ELSE PERFORM public.update_tournament_blinds(tour,levels);END IF;
   RAISE EXCEPTION 'blind204_expected_fault_missing';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TEST_BLIND204_SECOND_ROW_FAILURE' THEN RAISE;END IF;END;
  PERFORM set_config('role','none',true);
  IF (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id=tour) IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'blind204_partial_rows_after_fault_%',writer;END IF;
 END LOOP;
 EXECUTE 'DROP TRIGGER test_blind204_second_row_failure ON public.tournament_levels';EXECUTE 'DROP FUNCTION public.test_blind204_second_row_failure()';
END $test$;
ROLLBACK;
SELECT 'BLIND204_ROLE_TENANT_TWO_WRITERS_SECOND_ROW_FAULT_ROLLBACK_PASS';

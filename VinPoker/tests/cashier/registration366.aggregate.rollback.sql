\set ON_ERROR_STOP on
-- Run inside the same outer transaction as the NEW uninstalled candidate232.
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local366_only';END IF;
 IF (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status IN ('pending','confirmed'))<>8 THEN RAISE EXCEPTION 'single244_366_drift';END IF;
 IF (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='230d1ab0-54d5-48ad-80c9-7afcab25ed70' AND status IN ('pending','confirmed'))<>9 THEN RAISE EXCEPTION 'reentry366_drift';END IF;
 IF has_function_privilege('service_role','public.get_public_tournament_registration_summary_v1(uuid)','EXECUTE') THEN RAISE EXCEPTION 'excess_service_grant366';END IF;
 IF (SELECT proconfig FROM pg_proc WHERE oid='public.get_public_tournament_registration_summary_v1(uuid)'::regprocedure) IS DISTINCT FROM ARRAY['search_path=""'] THEN RAISE EXCEPTION 'unsafe_path366';END IF;
END $$;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"anon"}';
SET LOCAL ROLE anon;
DO $$ DECLARE result jsonb;keys text[]; BEGIN
 result:=public.get_public_tournament_registration_summary_v1('c367013a-3ed3-48af-ad48-3915acadc50e');
 IF result->>'ok'<>'true' OR (result->>'registration_count')::integer<>8 OR result->>'tournament_id'<>'c367013a-3ed3-48af-ad48-3915acadc50e' OR result->>'source'<>'canonical_registration_v1' THEN RAISE EXCEPTION 'wrong_aggregate366 %',result;END IF;
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(result) k;
 IF keys<>ARRAY['ok','registration_count','source','tournament_id'] THEN RAISE EXCEPTION 'unexpected_public_fields366';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e') THEN RAISE EXCEPTION 'raw_registration_leak366';END IF;
 IF (public.get_public_tournament_registration_summary_v1('230d1ab0-54d5-48ad-80c9-7afcab25ed70')->>'registration_count')::integer<>9 THEN RAISE EXCEPTION 'reentry_count_semantics_changed366';END IF;
 IF public.get_public_tournament_registration_summary_v1(NULL)->>'error'<>'invalid_request' THEN RAISE EXCEPTION 'null_tour_accepted366';END IF;
 IF public.get_public_tournament_registration_summary_v1('00000000-0000-4000-8000-000000000000')->>'error'<>'tournament_not_found' THEN RAISE EXCEPTION 'missing_tour_accepted366';END IF;
END $$;
RESET ROLE;
SAVEPOINT manual_floor366;
UPDATE public.tournaments SET current_players=12 WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
SET LOCAL ROLE anon;
DO $$ BEGIN IF (public.get_public_tournament_registration_summary_v1('c367013a-3ed3-48af-ad48-3915acadc50e')->>'registration_count')::integer<>12 THEN RAISE EXCEPTION 'manual_floor_not_preserved366';END IF;END $$;
RESET ROLE;
ROLLBACK TO manual_floor366;
SAVEPOINT deleted366;
UPDATE public.tournaments SET deleted_at=now() WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
SET LOCAL ROLE anon;
DO $$ BEGIN IF public.get_public_tournament_registration_summary_v1('c367013a-3ed3-48af-ad48-3915acadc50e')->>'error'<>'tournament_not_found' THEN RAISE EXCEPTION 'deleted_tour_leak366';END IF;END $$;
RESET ROLE;
ROLLBACK TO deleted366;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000099"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (public.get_public_tournament_registration_summary_v1('c367013a-3ed3-48af-ad48-3915acadc50e')->>'registration_count')::integer<>8 THEN RAISE EXCEPTION 'public_authenticated_count366';END IF;END $$;
RESET ROLE;
SELECT 'REGISTRATION366_NATIVE_ANON8_REENTRY9_MANUAL_FLOOR_DELETED_NULL_PRIVATE_ROWS_ACL_PASS';

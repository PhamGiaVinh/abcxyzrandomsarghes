-- Included by trackerRosterSession.pg17.sql inside its seeded rollback transaction.
-- Never execute against production. The caller supplies the current-schema fixture.
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated',
 'public.reenter_tournament_player(uuid,bigint,bigint,text)', 'EXECUTE')
 THEN RAISE EXCEPTION 'canonical_cashier_execute_missing'; END IF;
 IF (SELECT count(*) FROM public.lr01_canonical_snapshot) <> 1
 OR NOT EXISTS (
 SELECT 1 FROM public.lr01_canonical_snapshot s JOIN pg_proc p
 ON p.oid='public.reenter_tournament_player(uuid,bigint,bigint,text)'::regprocedure
 WHERE s.definition=pg_get_functiondef(p.oid) AND s.proowner=p.proowner
 AND s.prosecdef=p.prosecdef AND s.proconfig IS NOT DISTINCT FROM p.proconfig
 AND s.proacl IS NOT DISTINCT FROM p.proacl)
 THEN RAISE EXCEPTION 'canonical_cashier_catalog_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='f7280000-0000-4000-8000-000000000003')
 THEN RAISE EXCEPTION 'legacy_retirement_fixture_missing'; END IF;
 IF md5(replace(pg_get_functiondef('public.re_enter_tournament(uuid,uuid,integer)'::regprocedure),chr(13),''))
 IS DISTINCT FROM 'e0994c41b497a51e6f506d1208a4fc4d' THEN RAISE EXCEPTION 'legacy_retirement_function_drift'; END IF;
END $$;
CREATE TEMP TABLE legacy_retirement_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e) entries,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s) seats,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c) chips,
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h) hands,
 (SELECT player_id FROM public.tournament_entries WHERE tournament_id='f7280000-0000-4000-8000-000000000003' LIMIT 1) player_id;
GRANT SELECT ON legacy_retirement_before TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; v_player uuid; BEGIN
 SELECT player_id INTO STRICT v_player FROM legacy_retirement_before;
 r:=public.re_enter_tournament('f7280000-0000-4000-8000-000000000003',v_player,30000);
 IF r->>'status' IS DISTINCT FROM 'error' OR r->>'error' IS DISTINCT FROM 'LEGACY_REENTRY_RETIRED'
 THEN RAISE EXCEPTION 'legacy_reentry_not_retired'; END IF;
 r:=public.re_enter_tournament('f7280000-0000-4000-8000-000000000003',v_player,50000);
 IF r->>'error' IS DISTINCT FROM 'LEGACY_REENTRY_RETIRED' THEN RAISE EXCEPTION 'legacy_payload_retry_not_retired'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.re_enter_tournament(NULL,NULL,0);
 RAISE EXCEPTION 'anon_retired_writer_allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.re_enter_tournament(NULL,NULL,0);
 RAISE EXCEPTION 'service_retired_writer_allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e) IS DISTINCT FROM (SELECT entries FROM legacy_retirement_before)
 OR (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s) IS DISTINCT FROM (SELECT seats FROM legacy_retirement_before)
 OR (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c) IS DISTINCT FROM (SELECT chips FROM legacy_retirement_before)
 OR (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h) IS DISTINCT FROM (SELECT hands FROM legacy_retirement_before)
 THEN RAISE EXCEPTION 'legacy_retirement_mutated_fixture'; END IF;
END $$;
\echo LEGACY_REENTRY_RETIREMENT_EXISTING_ROSTER_PASS

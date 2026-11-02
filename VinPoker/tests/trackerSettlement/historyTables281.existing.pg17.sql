\set ON_ERROR_STOP on
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT (SELECT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='public.list_tracker_history_tables_v1(uuid)'::regprocedure);
 ASSERT has_function_privilege('authenticated','public.list_tracker_history_tables_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.list_tracker_history_tables_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.list_tracker_history_tables_v1(uuid)','EXECUTE');
END $$;
CREATE FUNCTION pg_temp.history281_fingerprint() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_object(
  'tables',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_tables x),
  'physical',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.game_tables x),
  'sessions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.table_sessions x),
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_hands x),
  'proofs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_settlement_outcomes x),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.cashier_buyin_movements x),
  'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_prize_payments x),
  'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.notifications x)
 )::text);
$$;
CREATE TEMP TABLE history281_before AS SELECT pg_temp.history281_fingerprint() fingerprint;
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c');
 ASSERT result->>'ok'='true' AND result->>'contract_version'='tracker-history-tables-v1';
 ASSERT jsonb_array_length(result->'tables')=3;
 ASSERT (SELECT count(DISTINCT t->>'tournament_table_id') FROM jsonb_array_elements(result->'tables') t)=3;
 ASSERT (SELECT count(*) FROM jsonb_array_elements(result->'tables') t WHERE t->>'table_status'='closed')=2;
 ASSERT (SELECT count(*) FROM jsonb_array_elements(result->'tables') t WHERE t->>'table_status'='active')=1;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'tables') t WHERE t->>'physical_table_id' IS NULL OR t->>'table_session_id' IS NULL OR t->>'table_name' IS NULL);
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'tables') t WHERE t->>'tournament_table_id'='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND t->>'table_session_id'='ee2b9393-0c96-42f9-8667-7f306edeb9bc');
END $$;
RESET ROLE;
\echo HISTORY281_AUTH_CANONICAL_ALL_THREE_CLOSED_REOPENED_DISTINCT_PASS
SAVEPOINT dual_id;
UPDATE public.tournament_tables SET table_id='c474ac95-6896-445d-81ba-dd6d752528df' WHERE id='009305c5-308b-4e67-81b1-f1e1e8cc5747';
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c')->>'error'='table_identity_conflict'; END $$;
RESET ROLE;
ROLLBACK TO dual_id;
SAVEPOINT foreign_session;
DO $$ DECLARE constraint_name text; BEGIN
 BEGIN
  UPDATE public.table_sessions SET club_id='e2720000-0000-4000-8000-000000000010' WHERE id='395420ac-28b8-4a9e-a240-eaa82dc0fde3';
  ASSERT public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c')->>'error'='table_identity_unavailable';
 EXCEPTION WHEN foreign_key_violation THEN
  GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
  ASSERT constraint_name='table_sessions_game_table_club_v3_fkey';
 END;
END $$;
ROLLBACK TO foreign_session;
SAVEPOINT foreign_physical;
DO $$ DECLARE constraint_name text; BEGIN
 BEGIN
  -- This existing TEST club has no canonical number1, so the intended composite
  -- tenant FK is exercised rather than an unrelated table-number uniqueness rule.
  UPDATE public.game_tables SET club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' WHERE id='96be0779-90f9-4851-9596-1d53f721c3c8';
  ASSERT public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c')->>'error'='table_identity_unavailable';
 EXCEPTION WHEN foreign_key_violation THEN
  GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
  ASSERT constraint_name='table_sessions_game_table_club_v3_fkey';
 END;
END $$;
ROLLBACK TO foreign_physical;
\echo HISTORY281_DUAL_ID_FOREIGN_SESSION_FOREIGN_PHYSICAL_FAIL_CLOSED_PASS
SET LOCAL request.jwt.claim.sub='e2720000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"e2720000-0000-4000-8000-000000000002"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c')->>'error'='actor_not_allowed'; END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c')->>'error'='unauthorized'; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c'); RAISE EXCEPTION 'anon unexpectedly executed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.list_tracker_history_tables_v1('46cab483-91e7-4220-aacf-e17bdf05269c'); RAISE EXCEPTION 'service unexpectedly executed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo HISTORY281_OUTSIDER_NO_ACTOR_ANON_SERVICE_DENIED_PASS
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.list_tracker_history_tables_v1('c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT result->>'ok'='true' AND result->'tables'='[]'::jsonb;
END $$;
RESET ROLE;
ROLLBACK;
DO $$ BEGIN ASSERT pg_temp.history281_fingerprint()=(SELECT fingerprint FROM history281_before),'retained global state changed'; END $$;
\echo HISTORY281_REAL_EMPTY_SCOPE_GLOBAL_TABLES_SESSIONS_HANDS_PROOFS_CASH_PRIZES_NOTICES_UNCHANGED_PASS

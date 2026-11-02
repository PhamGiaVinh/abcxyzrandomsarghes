-- Exact linked reopen occurred through Floor UI. Never reopen by changing rows.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='0f8ed188-785b-4105-a8c2-6a93f6192f01'
  AND game_table_id='96be0779-90f9-4851-9596-1d53f721c3c8'
  AND tournament_id='782a5196-5ea1-44ed-8a27-1b872d5f88d9' AND closed_at IS NULL AND revision=1);
END $$;
CREATE TEMP TABLE release180_before AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x)
 )::text) fingerprint;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;
BEGIN
 r:=public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac',
  'c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'6ce39161-cd80-4114-b076-310353fa2be2');
 ASSERT r->>'closed'='true' AND r->>'table_session_id'='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55' AND r->>'revision'='11';
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac',
   '0f8ed188-785b-4105-a8c2-6a93f6192f01',10,'9b83697a48dba8fac105ffbf058147a1',1,'6ce39161-cd80-4114-b076-310353fa2be2');
  RAISE EXCEPTION 'old_key_new_session_accepted';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='IDEMPOTENCY_CONFLICT',SQLERRM; END;
END $$;
RESET ROLE;
-- Only this rollback transaction enables the package for the fresh-key probe.
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac',
   '0f8ed188-785b-4105-a8c2-6a93f6192f01',1,'9b83697a48dba8fac105ffbf058147a1',1,'18000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'old_logical_table_closed_new_session';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='bagged_release_session_mismatch',SQLERRM; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM release180_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x))::text);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.bagged_flight_release_permits_v1);
END $$;
SELECT 'RELEASE180_OLD_RECEIPT_REPLAY_REOPEN_NEW_SESSION_UNTOUCHED_PASS';
ROLLBACK;

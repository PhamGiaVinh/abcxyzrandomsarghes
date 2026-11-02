-- CLI candidate20261019090808; forward182 after source collision check.
-- LOCAL qualification only. Retire unused client/service direct ranking API.
-- Real server callers retain their existing postgres-owned SECURITY DEFINER
-- context and existing eligibility checks. Do not alter ranking or cash policy.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path='';
DO $guard$
DECLARE target oid:='public.finalize_tournament_results(uuid)'::regprocedure;
 expected_callers oid[]:=ARRAY['public.auto_finalize_on_last_bust()'::regprocedure::oid,
  'public.apply_payout_run(uuid,jsonb,bigint,integer,bigint,jsonb,text,text)'::regprocedure::oid,
  'floor_private.felt_finalize_official_results_at_close_v1()'::regprocedure::oid];
 actual_callers oid[];
BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_catalog.pg_get_functiondef(target),chr(13),''))<>'df45256a89b7a56fe6d7630803ff241a'
 THEN RAISE EXCEPTION 'finalizer182_owner_definition_drift'; END IF;
 SELECT array_agg(p.oid ORDER BY p.oid) INTO actual_callers FROM pg_catalog.pg_proc p
 WHERE p.prosrc ILIKE '%finalize_tournament_results%' AND p.oid<>target;
 SELECT array_agg(c ORDER BY c) INTO expected_callers FROM unnest(expected_callers) c;
 IF actual_callers IS DISTINCT FROM expected_callers OR EXISTS(
  SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=ANY(expected_callers)
   AND (NOT p.prosecdef OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'))
 THEN RAISE EXCEPTION 'finalizer182_server_caller_drift'; END IF;
END;
$guard$;
REVOKE EXECUTE ON FUNCTION public.finalize_tournament_results(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF NOT pg_catalog.has_function_privilege('postgres','public.finalize_tournament_results(uuid)','EXECUTE')
 OR pg_catalog.has_function_privilege('anon','public.finalize_tournament_results(uuid)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE')
 OR pg_catalog.has_function_privilege('service_role','public.finalize_tournament_results(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'finalizer182_execute_postcheck_failed'; END IF;
END; $$;
-- Recovery: keep server-only boundary. Route operations through canonical close.
-- Regrant only after a separately reviewed forward API enforces finalization
-- eligibility/immutability; do not restore unsafe legacy direct calls routinely.
COMMIT;

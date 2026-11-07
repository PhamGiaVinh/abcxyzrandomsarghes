-- One fresh public table/access read and clock read in one HTTP transaction.
-- Canonical readers retain all scope, visibility, session and card masks.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF current_user<>'postgres' OR EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_public_tournament_table_clock_v1')
 OR NOT EXISTS(SELECT 1 FROM pg_proc p
  JOIN spectator_projection_v2.current_table_read_originals_v1 b ON b.signature='public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)'
  WHERE p.oid='public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)'::regprocedure
   AND p.proowner='postgres'::regrole AND p.provolatile='s' AND p.prosecdef
   AND md5(replace(pg_get_functiondef(p.oid),chr(13),''))=b.prepared_definition_hash)
 OR NOT EXISTS(SELECT 1 FROM pg_proc p
  JOIN spectator_projection_v2.clock_numeric_original_v1 b ON b.signature='public.get_public_tournament_clock_summary(uuid)'
  WHERE p.oid='public.get_public_tournament_clock_summary(uuid)'::regprocedure
   AND p.proowner='postgres'::regrole AND p.provolatile='s' AND p.prosecdef
   AND md5(replace(pg_get_functiondef(p.oid),chr(13),''))=b.candidate_definition_hash)
 THEN RAISE EXCEPTION 'public_table_clock_bundle_dependency_or_collision';END IF;
END $guard$;
CREATE FUNCTION public.get_public_tournament_table_clock_v1(p_tournament_id uuid,p_tournament_table_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $read$
DECLARE table_payload jsonb;clock_payload jsonb;
BEGIN
 table_payload:=public.get_public_tournament_table_live_or_last_hand_v2(p_tournament_id,p_tournament_table_id);
 -- A definitive denial must survive an unrelated clock permission/read error.
 IF table_payload->>'access' IS DISTINCT FROM 'public' THEN
  RETURN jsonb_build_object('table',table_payload,'clock','[]'::jsonb);
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) INTO clock_payload
 FROM public.get_public_tournament_clock_summary(p_tournament_id) c;
 RETURN jsonb_build_object('table',table_payload,'clock',clock_payload);
END;
$read$;
REVOKE ALL ON FUNCTION public.get_public_tournament_table_clock_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_table_clock_v1(uuid,uuid) TO anon,authenticated;
COMMIT;

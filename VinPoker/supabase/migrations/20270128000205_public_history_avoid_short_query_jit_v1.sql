-- CLI scaffold:20261020083609; forward205 reserved against the local catalog.
-- Short public history reads spent >1s compiling JIT for ~20ms execution.
-- Keep source/proof/ACL semantics intact. Only this function opts out of JIT.
-- Recovery: ALTER FUNCTION ... RESET jit after verifying the pinned metadata.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE target regprocedure:='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)'::regprocedure;
 before_row record;after_row record;
BEGIN
 SELECT p.*,md5(replace(pg_get_functiondef(p.oid),chr(13),'')) AS definition_hash INTO STRICT before_row FROM pg_proc p WHERE oid=target;
 IF current_user<>'postgres' OR before_row.definition_hash<>'03286294d8c212e675b5c6baeb3ff901'
 OR before_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
  RAISE EXCEPTION 'history205_definition_or_config_drift';
 END IF;
 ALTER FUNCTION public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid) SET jit TO off;
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=target;
 IF after_row.prosrc IS DISTINCT FROM before_row.prosrc OR after_row.proacl IS DISTINCT FROM before_row.proacl
 OR after_row.proowner<>before_row.proowner OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef
 OR after_row.provolatile IS DISTINCT FROM before_row.provolatile
 OR array_remove(after_row.proconfig,'jit=off') IS DISTINCT FROM before_row.proconfig
 OR NOT after_row.proconfig@>ARRAY['jit=off']::text[] THEN
  RAISE EXCEPTION 'history205_unexpected_metadata_change';
 END IF;
END $guard$;
COMMIT;

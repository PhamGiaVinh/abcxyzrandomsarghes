-- Restore the prior two-reader client first, then remove only this additive RPC.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_proc
  WHERE oid=to_regprocedure('public.get_public_tournament_table_clock_v1(uuid,uuid)')
   AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='s'
   AND proconfig=ARRAY['search_path=""']::text[]
   AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'
   AND md5(replace(pg_get_functiondef(oid),chr(13),''))='083f2a11d08983ed867acbee5bfb3bdc')
 THEN RAISE EXCEPTION 'public_table_clock_bundle_recovery_drift';END IF;
END $guard$;
DROP FUNCTION public.get_public_tournament_table_clock_v1(uuid,uuid);
COMMIT;

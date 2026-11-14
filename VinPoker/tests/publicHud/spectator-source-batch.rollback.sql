-- Isolated verification or separately approved rollback only. No source writes.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(
  SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_public_spectator_projection_sources_v2(jsonb)')
  AND proowner='postgres'::regrole AND prosecdef AND provolatile='s'
  AND proconfig=ARRAY['search_path=""']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  AND md5(replace(prosrc,chr(13),''))='4f3b48343181275c73c002c0591f3318')
 THEN RAISE EXCEPTION 'spectator_source_batch_rollback_drift';END IF;
END $guard$;
DROP FUNCTION public.get_public_spectator_projection_sources_v2(jsonb);
COMMIT;
